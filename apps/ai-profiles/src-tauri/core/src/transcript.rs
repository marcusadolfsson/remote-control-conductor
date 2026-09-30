//! Reading Claude Code transcripts: `<config>/projects/<project>/<id>.jsonl`.
//!
//! A transcript is a JSONL file Claude Code appends a record to as the session
//! goes: messages (`user`, `assistant`, `attachment`, `system`, most carrying
//! `timestamp`, `cwd` and `isSidechain`) and metadata (`custom-title`,
//! `ai-title`, `last-prompt`, `relocated`) that is re-appended whenever it
//! changes, so the last record of each kind is the current one. A long-running
//! session's reaches hundreds of megabytes, so a transcript read before is read
//! on from where reading stopped ([`read_on`]), and only lines that can hold a
//! field read here are decoded at all.
//!
//! The reading follows ai-profiles' own (`src/sessions/claude/transcript.rs`
//! in the app), which the server can't use as it is: it lives in the app, with
//! its cache.
//!
//! Everything here reads Claude Code internals, which can change between
//! versions.

use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::hash::Hasher;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;
use serde_json::value::RawValue;

/// What a transcript says about its session.
#[derive(Debug, Default, Clone)]
pub struct TranscriptInfo {
    /// The folder the session last worked in: the `cwd` of its last message,
    /// or where it was last relocated to.
    pub cwd: Option<String>,
    /// The name set with `/rename`: the last `custom-title` record.
    pub custom_title: Option<String>,
    /// The title Claude generated: the last `ai-title` record.
    pub ai_title: Option<String>,
    /// The first text the user typed, cut to [`FIRST_PROMPT_MAX_CHARS`].
    pub first_prompt: Option<String>,
    /// The last thing typed into the session: the last `last-prompt` record.
    pub last_prompt: Option<String>,
    /// The first record's `timestamp`.
    pub first_timestamp: Option<String>,
    /// The last record's `timestamp`: when the session was last used.
    pub last_timestamp: Option<String>,
    /// Claude replied at least once.
    pub has_reply: bool,
    /// Plan slugs the session wrote, `plans/<slug>.md`.
    pub slugs: BTreeSet<String>,
    /// A record of a subagent's conversation was read.
    sidechain_seen: bool,
    /// A record of the session's own conversation was read.
    main_seen: bool,
}

impl TranscriptInfo {
    /// Opened and closed without anything happening, like Claude's own
    /// `/resume` hides.
    pub fn is_empty(&self) -> bool {
        !self.has_reply && self.last_prompt.is_none()
    }

    /// The transcript holds a subagent's records only: not a session of its
    /// own.
    pub fn subagent_only(&self) -> bool {
        self.sidechain_seen && !self.main_seen
    }

    pub fn title(&self) -> Option<String> {
        self.custom_title.clone().or_else(|| self.ai_title.clone())
    }

    /// What to call the session where nothing has named it better: its
    /// `/rename` name (the bool is true: the user chose it), else Claude's
    /// generated title, else its last prompt cut to a short line.
    pub fn name(&self) -> Option<(String, bool)> {
        if let Some(title) = &self.custom_title {
            return Some((title.clone(), true));
        }
        self.ai_title
            .clone()
            .or_else(|| self.last_prompt.as_deref().and_then(short_line))
            .map(|name| (name, false))
    }

    /// Take in the record on `line`. A line that isn't UTF-8, or isn't a
    /// record, like one Claude Code is still writing, is skipped, as is one
    /// without a field read here.
    fn read(&mut self, line: &[u8]) {
        let Ok(line) = std::str::from_utf8(line) else {
            return;
        };
        if !MARKERS.iter().any(|marker| line.contains(marker)) {
            return;
        }
        let Ok(record) = serde_json::from_str::<Record>(line) else {
            return;
        };
        match record.is_sidechain {
            Some(true) => self.sidechain_seen = true,
            Some(false) => self.main_seen = true,
            None => {}
        }
        if record.timestamp.is_some() {
            if self.first_timestamp.is_none() {
                self.first_timestamp.clone_from(&record.timestamp);
            }
            self.last_timestamp = record.timestamp;
        }
        if let Some(slug) = record
            .slug
            .filter(|slug| is_safe_name(slug) && !slug.starts_with('.'))
        {
            self.slugs.insert(slug);
        }
        match record.kind.as_deref() {
            Some(kind @ ("user" | "assistant")) => {
                if record.cwd.is_some() {
                    self.cwd = record.cwd;
                }
                if kind == "assistant" {
                    self.has_reply = true;
                }
                let typed = kind == "user" && record.is_sidechain != Some(true) && !record.is_meta;
                if typed && self.first_prompt.is_none() {
                    self.first_prompt = record.message.and_then(first_text);
                }
            }
            Some("custom-title") => {
                self.custom_title = record.custom_title.or(self.custom_title.take());
            }
            Some("ai-title") => self.ai_title = record.ai_title.or(self.ai_title.take()),
            Some("last-prompt") => {
                self.last_prompt = record.last_prompt.or(self.last_prompt.take());
            }
            Some("relocated") => self.cwd = record.relocated_cwd.or(self.cwd.take()),
            _ => {}
        }
    }
}

/// How much of the first prompt is kept.
const FIRST_PROMPT_MAX_CHARS: usize = 200;

/// A line is only decoded if it contains one of these: every record read here
/// carries one, and decoding the rest (tool output, file snapshots) is most of
/// the cost of reading a transcript.
const MARKERS: [&str; 8] = [
    "\"timestamp\"",
    "\"slug\"",
    "\"custom-title\"",
    "\"ai-title\"",
    "\"last-prompt\"",
    "\"relocated\"",
    "\"type\":\"user\"",
    "\"type\":\"assistant\"",
];

/// The fields of a transcript record read here. Everything else is skipped
/// without being built.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record<'a> {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    /// The record belongs to a subagent's conversation, not the session's own.
    is_sidechain: Option<bool>,
    /// A message Claude Code added on the user's behalf, not one they typed.
    #[serde(default)]
    is_meta: bool,
    custom_title: Option<String>,
    ai_title: Option<String>,
    last_prompt: Option<String>,
    /// Of a `relocated` record: the folder the session moved to.
    relocated_cwd: Option<String>,
    slug: Option<String>,
    /// Of a message, as written: read only when it may hold the first prompt.
    #[serde(borrow)]
    message: Option<&'a RawValue>,
}

/// A user message, once it may hold the first prompt.
#[derive(Deserialize)]
struct UserMessage {
    content: Content,
}

/// A message's content: plain text, or blocks (text, images, tool results).
#[derive(Deserialize)]
#[serde(untagged)]
enum Content {
    Text(String),
    Blocks(Vec<Block>),
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

/// The text of the user's `message`, trimmed and cut to
/// [`FIRST_PROMPT_MAX_CHARS`]: its content if plain text, else its first
/// non-blank text block. `None` for a message with no text, like a tool
/// result.
fn first_text(message: &RawValue) -> Option<String> {
    let message = serde_json::from_str::<UserMessage>(message.get()).ok()?;
    let text = match message.content {
        Content::Text(text) => text,
        Content::Blocks(blocks) => blocks
            .into_iter()
            .filter(|block| block.kind.as_deref() == Some("text"))
            .filter_map(|block| block.text)
            .find(|text| !text.trim().is_empty())?,
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(FIRST_PROMPT_MAX_CHARS).collect())
}

/// What reading a transcript found, kept to read on from next time.
#[derive(Debug, Clone)]
pub struct TranscriptRead {
    /// The file's inode when read: a file replaced by another is read afresh.
    inode: u64,
    len: u64,
    modified: SystemTime,
    /// How far it was read: the end of its last whole line.
    offset: u64,
    /// Where that last whole line starts.
    last_line_start: u64,
    /// A hash of the file's start and of its last whole line, as read: a file
    /// that no longer has them was rewritten, not appended to. `None` when
    /// they couldn't be read.
    fingerprint: Option<u64>,
    /// What its whole lines up to `offset` say.
    scan: TranscriptInfo,
    /// What the whole file says, with a last line still being written.
    info: TranscriptInfo,
}

impl TranscriptRead {
    /// What the transcript says.
    pub fn info(&self) -> &TranscriptInfo {
        &self.info
    }

    /// When the file was last written, as read.
    pub fn modified(&self) -> SystemTime {
        self.modified
    }

    /// The file's size in bytes, as read.
    pub fn size(&self) -> u64 {
        self.len
    }
}

/// Read the transcript at `path`, gzipped when it ends in `.gz` (as an
/// archived one does). With `previous`, what an earlier read of it found, a
/// file that hasn't changed isn't read again, and one that only grew, as a
/// running session's does, is read on from where that read stopped. A file
/// replaced by another, cut shorter, or no longer starting or ending its read
/// part the way it did is read afresh. Claude Code only ever appends to a
/// transcript; a rewrite that keeps both goes unseen until the file is
/// replaced or cut shorter.
pub fn read_on(path: &Path, previous: Option<TranscriptRead>) -> io::Result<TranscriptRead> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    let (inode, len, modified) = (metadata.ino(), metadata.len(), metadata.modified()?);
    if let Some(previous) = &previous {
        if previous.inode == inode && previous.len == len && previous.modified == modified {
            return Ok(previous.clone());
        }
    }
    if path.extension().is_some_and(|ext| ext == "gz") {
        let mut scan = TranscriptInfo::default();
        let reader = BufReader::new(flate2::read::GzDecoder::new(file));
        let (_, _, tail) = read_lines(reader, &mut scan);
        return Ok(TranscriptRead {
            inode,
            len,
            modified,
            offset: len,
            last_line_start: len,
            fingerprint: None,
            info: with_tail(&scan, tail.as_deref()),
            scan,
        });
    }
    let (start, mut last_line_start, mut scan) = match previous {
        Some(previous) if grew(&mut file, &previous, inode, len) => {
            (previous.offset, previous.last_line_start, previous.scan)
        }
        _ => (0, 0, TranscriptInfo::default()),
    };
    file.seek(SeekFrom::Start(start))?;
    let mut reader = BufReader::with_capacity(1 << 16, file);
    let (read, last_line_len, tail) = read_lines(&mut reader, &mut scan);
    let offset = start + read;
    if last_line_len > 0 {
        last_line_start = offset - last_line_len;
    }
    Ok(TranscriptRead {
        inode,
        len,
        modified,
        offset,
        last_line_start,
        fingerprint: fingerprint(reader.get_mut(), offset, last_line_start),
        info: with_tail(&scan, tail.as_deref()),
        scan,
    })
}

/// Read what the Sessions list needs from the transcript at `path`, all of it.
pub fn read_transcript(path: &Path) -> io::Result<TranscriptInfo> {
    read_on(path, None).map(|read| read.info)
}

/// What `scan` says with `tail`, a last line still being written, if it
/// already reads as a record.
fn with_tail(scan: &TranscriptInfo, tail: Option<&[u8]>) -> TranscriptInfo {
    let mut whole = scan.clone();
    if let Some(tail) = tail {
        whole.read(tail);
    }
    whole
}

/// Read the lines `reader` holds into `scan`, up to the end of its last whole
/// line. Returns how many bytes those are and how long the last of them is,
/// with the line after them that has no end yet, which Claude Code may still
/// be writing. Reading stops early, as at the end, when the file can't be
/// read on.
fn read_lines(mut reader: impl BufRead, scan: &mut TranscriptInfo) -> (u64, u64, Option<Vec<u8>>) {
    let (mut read, mut last_line_len) = (0, 0);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return (read, last_line_len, None),
            Ok(_) if line.last() != Some(&b'\n') => return (read, last_line_len, Some(line)),
            Ok(count) => {
                read += count as u64;
                last_line_len = count as u64;
                scan.read(&line);
            }
        }
    }
}

/// Whether `file`, read before as `previous` and now of `inode` and `len`,
/// only grew since: it is the same file, no shorter, and still has the start
/// and the last whole line it had where reading stopped (see [`fingerprint`]).
fn grew(file: &mut File, previous: &TranscriptRead, inode: u64, len: u64) -> bool {
    if previous.inode != inode || len < previous.len {
        return false;
    }
    if previous.offset == 0 {
        return true;
    }
    previous.fingerprint.is_some()
        && fingerprint(file, previous.offset, previous.last_line_start) == previous.fingerprint
}

/// How much of the start of a transcript [`fingerprint`] hashes.
const FINGERPRINT_HEAD: u64 = 4096;

/// A hash of `file`'s first [`FINGERPRINT_HEAD`] bytes before `offset`, and
/// of its line from `last_line_start` to `offset`. `None` when they can't be
/// read.
fn fingerprint(file: &mut File, offset: u64, last_line_start: u64) -> Option<u64> {
    let mut hasher = DefaultHasher::new();
    for (from, to) in [(0, offset.min(FINGERPRINT_HEAD)), (last_line_start, offset)] {
        let mut bytes = vec![0_u8; usize::try_from(to.checked_sub(from)?).ok()?];
        file.seek(SeekFrom::Start(from)).ok()?;
        file.read_exact(&mut bytes).ok()?;
        hasher.write(&bytes);
    }
    Some(hasher.finish())
}

/// The name set with `/rename` that Claude Code keeps beside the transcript at
/// `transcript`, in `<slug>/<id>/custom-title.json`, when a transcript record
/// doesn't carry it. It changes on its own, so it's read each time it's asked
/// for rather than kept with the transcript's read.
pub fn title_file(transcript: &Path) -> Option<String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TitleFile {
        custom_title: Option<String>,
    }
    let id = transcript.file_stem()?;
    let text = fs::read_to_string(transcript.with_file_name(id).join("custom-title.json")).ok()?;
    serde_json::from_str::<TitleFile>(&text)
        .ok()?
        .custom_title
        .filter(|title| !title.trim().is_empty())
}

/// The first line of `text`, trimmed, cut to a title's length on a character
/// boundary. `None` when nothing is left.
pub fn short_line(text: &str) -> Option<String> {
    const MAX_CHARS: usize = 60;
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    if line.chars().count() <= MAX_CHARS {
        return Some(line.to_string());
    }
    let cut: String = line.chars().take(MAX_CHARS - 1).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// A file name that stays inside the folder it is joined to.
pub fn is_safe_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\0')
}

/// Every transcript in `config_dir`: `projects/<project>/<id>.jsonl`, one level
/// down only, since subagent transcripts sit deeper. Returns (project, id, path).
pub fn transcripts(config_dir: &Path) -> Vec<(String, String, PathBuf)> {
    let Ok(projects) = fs::read_dir(config_dir.join("projects")) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for project in projects.flatten() {
        if !project.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let project_name = project.file_name().to_string_lossy().into_owned();
        let Ok(files) = fs::read_dir(project.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            if !file.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            let Some(id) = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
            else {
                continue;
            };
            found.push((project_name.clone(), id, path));
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::{json, Value};

    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn append(path: &Path, text: &str) {
        let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }

    fn lines(records: &[Value]) -> String {
        records.iter().map(|record| format!("{record}\n")).collect()
    }

    fn user(timestamp: &str, cwd: &str, content: Value) -> Value {
        json!({
            "type": "user",
            "timestamp": timestamp,
            "cwd": cwd,
            "isSidechain": false,
            "message": { "role": "user", "content": content },
        })
    }

    fn assistant(timestamp: &str, cwd: &str) -> Value {
        json!({
            "type": "assistant",
            "timestamp": timestamp,
            "cwd": cwd,
            "isSidechain": false,
            "message": { "role": "assistant", "content": [{ "type": "text", "text": "Done." }] },
        })
    }

    #[test]
    fn a_transcript_is_read_from_its_latest_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let mut records = vec![
            user(
                "2026-09-01T10:00:00Z",
                "/work/app",
                json!("  Fix the login bug  "),
            ),
            json!({ "type": "ai-title", "aiTitle": "Login fix" }),
            json!({ "type": "custom-title", "customTitle": "First name" }),
            assistant("2026-09-01T10:05:00Z", "/work/app"),
            json!({ "type": "custom-title", "customTitle": "Second name" }),
            json!({ "type": "last-prompt", "lastPrompt": "Fix the login bug" }),
            user(
                "2026-09-01T10:07:30Z",
                "/work/app/web",
                json!([{ "type": "text", "text": "And logout" }]),
            ),
            json!({ "type": "last-prompt", "lastPrompt": "And logout" }),
            json!({ "type": "assistant", "slug": "bold-plan", "timestamp": "2026-09-01T10:08:00Z" }),
            json!({ "type": "assistant", "slug": "../escape" }),
        ];
        records.insert(2, json!("not a record"));
        write(&path, &format!("{}{{not json\n", lines(&records)));

        let info = read_transcript(&path).unwrap();
        assert_eq!(info.cwd.as_deref(), Some("/work/app/web"));
        assert_eq!(info.title().as_deref(), Some("Second name"));
        assert_eq!(info.first_prompt.as_deref(), Some("Fix the login bug"));
        assert_eq!(info.last_prompt.as_deref(), Some("And logout"));
        assert_eq!(
            info.first_timestamp.as_deref(),
            Some("2026-09-01T10:00:00Z")
        );
        assert_eq!(info.last_timestamp.as_deref(), Some("2026-09-01T10:08:00Z"));
        assert!(info.has_reply);
        assert_eq!(info.slugs.iter().collect::<Vec<_>>(), vec!["bold-plan"]);
    }

    #[test]
    fn the_first_prompt_is_the_first_text_the_user_typed_cut_to_200_chars() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let mut meta = user(
            "2026-09-01T10:00:00Z",
            "/work",
            json!("<local-command-caveat>"),
        );
        meta["isMeta"] = json!(true);
        write(
            &path,
            &lines(&[
                meta,
                user(
                    "2026-09-01T10:00:01Z",
                    "/work",
                    json!([{ "type": "tool_result", "tool_use_id": "t", "content": "output" }]),
                ),
                user("2026-09-01T10:00:02Z", "/work", json!("é".repeat(250))),
            ]),
        );
        let first = read_transcript(&path).unwrap().first_prompt.unwrap();
        assert_eq!(first.chars().count(), 200);
    }

    #[test]
    fn a_relocated_session_works_in_its_new_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        write(
            &path,
            &lines(&[
                user("2026-09-01T10:00:00Z", "/old", json!("hi")),
                json!({ "type": "relocated", "relocatedCwd": "/new" }),
            ]),
        );
        assert_eq!(read_transcript(&path).unwrap().cwd.as_deref(), Some("/new"));
    }

    #[test]
    fn a_transcript_of_subagent_records_only_is_no_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let mut side = user("2026-09-01T10:00:00Z", "/work", json!("task"));
        side["isSidechain"] = json!(true);
        write(&path, &lines(&[side.clone()]));
        assert!(read_transcript(&path).unwrap().subagent_only());
        append(
            &path,
            &lines(&[user("2026-09-01T10:01:00Z", "/work", json!("mine"))]),
        );
        assert!(!read_transcript(&path).unwrap().subagent_only());
    }

    #[test]
    fn reading_on_reads_only_what_was_appended_and_ends_as_a_whole_read_would() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        let first = lines(&[user("2026-09-01T10:00:00Z", "/a", json!("start"))]);
        // The last line is still being written.
        write(&path, &format!("{first}{{\"type\":\"ai-title\",\"aiTit"));
        let read = read_on(&path, None).unwrap();
        assert_eq!(read.offset, first.len() as u64);
        assert_eq!(read.info().ai_title, None);

        let rest = lines(&[
            json!({ "type": "ai-title", "aiTitle": "Named" }),
            assistant("2026-09-01T10:01:00Z", "/b"),
        ]);
        write(&path, &format!("{first}{rest}"));
        let read = read_on(&path, Some(read)).unwrap();
        let whole = read_transcript(&path).unwrap();
        for info in [read.info(), &whole] {
            assert_eq!(info.ai_title.as_deref(), Some("Named"));
            assert_eq!(info.cwd.as_deref(), Some("/b"));
            assert_eq!(info.first_prompt.as_deref(), Some("start"));
            assert!(info.has_reply);
        }
    }

    #[test]
    fn a_last_line_already_whole_counts_before_its_newline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        write(&path, r#"{"type":"last-prompt","lastPrompt":"go"}"#);
        let read = read_on(&path, None).unwrap();
        assert_eq!(read.info().last_prompt.as_deref(), Some("go"));
        assert_eq!(read.offset, 0);
    }

    #[test]
    fn a_rewritten_transcript_is_read_afresh() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        write(
            &path,
            &lines(&[user("2026-09-01T10:00:00Z", "/a", json!("one"))]),
        );
        let read = read_on(&path, None).unwrap();
        // Rewritten in place, longer, with a different start: not appended to.
        write(
            &path,
            &lines(&[
                user("2026-09-01T11:00:00Z", "/b", json!("two")),
                user("2026-09-01T11:00:01Z", "/b", json!("three")),
            ]),
        );
        let read = read_on(&path, Some(read)).unwrap();
        assert_eq!(read.info().first_prompt.as_deref(), Some("two"));
        assert_eq!(read.info().cwd.as_deref(), Some("/b"));
    }

    #[test]
    fn an_unchanged_transcript_is_not_read_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        write(
            &path,
            &lines(&[user("2026-09-01T10:00:00Z", "/a", json!("one"))]),
        );
        let read = read_on(&path, None).unwrap();
        let again = read_on(&path, Some(read.clone())).unwrap();
        assert_eq!(again.offset, read.offset);
        assert_eq!(again.info().first_prompt, read.info().first_prompt);
    }

    #[test]
    fn a_rename_kept_beside_the_transcript_is_its_title_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("-work").join("abc.jsonl");
        write(&path, "");
        assert_eq!(title_file(&path), None);
        write(
            &dir.path().join("-work/abc/custom-title.json"),
            r#"{"customTitle":"Billing"}"#,
        );
        assert_eq!(title_file(&path).as_deref(), Some("Billing"));
    }

    #[test]
    fn name_prefers_the_users_name_then_claudes_then_the_last_prompt() {
        let mut info = TranscriptInfo {
            last_prompt: Some("\n  Reply with just: ok  \nand more".into()),
            ..TranscriptInfo::default()
        };
        assert_eq!(info.name(), Some(("Reply with just: ok".into(), false)));
        info.ai_title = Some("Generated".into());
        assert_eq!(info.name(), Some(("Generated".into(), false)));
        info.custom_title = Some("Mine".into());
        assert_eq!(info.name(), Some(("Mine".into(), true)));
        assert_eq!(TranscriptInfo::default().name(), None);
    }

    #[test]
    fn short_line_cuts_long_prompts_on_a_character_boundary() {
        let long = "é".repeat(100);
        let cut = short_line(&long).unwrap();
        assert_eq!(cut.chars().count(), 60);
        assert!(cut.ends_with('…'));
        assert_eq!(short_line("   \n  "), None);
    }

    #[test]
    fn a_session_nothing_happened_in_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.jsonl");
        write(&path, "{\"type\":\"user\",\"cwd\":\"/w\"}\n");
        assert!(read_transcript(&path).unwrap().is_empty());
    }

    #[test]
    fn transcripts_skips_subagent_transcripts_and_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("projects/-work");
        write(&project.join("a.jsonl"), "");
        write(&project.join("a/subagents/agent-x.jsonl"), "");
        write(&project.join("memory/MEMORY.md"), "");
        write(&dir.path().join("projects/stray.jsonl"), "");
        let found = transcripts(dir.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, "-work");
        assert_eq!(found[0].1, "a");
    }
}
