//! Reading a Remote Control server's window: whether it has connected (and
//! its page on claude.ai), or what it's waiting for someone to answer. The
//! same reading the Linux server does of its own servers' windows.

use conductor_core::api::Attention;

/// What a server's window says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Screen {
    /// Connected, with its page on claude.ai once it shows one.
    Connected { url: Option<String> },
    /// "Trust <folder>? [y/N]", and whether it says the folder's settings
    /// pre-approve anything.
    TrustQuestion { preapproves: bool },
    /// Remote Control's one-time "Enable Remote Control? (y/n)".
    EnableQuestion,
    /// None of those yet.
    Starting,
}

const ENVIRONMENT_PREFIX: &str = "https://claude.ai/code?environment=";

/// Pure: read a server's window.
pub fn read(screen: &str) -> Screen {
    let lines: Vec<&str> = screen
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let last = lines.last().copied().unwrap_or_default();
    if last.starts_with("Trust ") && last.ends_with("[y/N]") {
        let question = screen
            .rfind("Quick safety check")
            .map_or(screen, |at| &screen[at..]);
        return Screen::TrustQuestion {
            preapproves: question.to_lowercase().contains("pre-approve"),
        };
    }
    if last.contains("Enable Remote Control?") {
        return Screen::EnableQuestion;
    }
    let connected = lines
        .iter()
        .rev()
        .take(12)
        .any(|line| line.contains("Connected") && !line.contains("Disconnected"));
    if connected {
        let url = screen
            .split_whitespace()
            .find(|word| word.starts_with(ENVIRONMENT_PREFIX))
            .map(str::to_owned);
        return Screen::Connected { url };
    }
    Screen::Starting
}

/// Pure: what a window is waiting for someone to answer, if anything.
pub fn attention(screen: &Screen, text: &str) -> Option<Attention> {
    let kind = match screen {
        Screen::Connected { .. } | Screen::Starting => return None,
        Screen::TrustQuestion { preapproves: true } => "trustPermissions",
        Screen::TrustQuestion { preapproves: false } => "trustPrompt",
        Screen::EnableQuestion => "waiting",
    };
    Some(Attention {
        kind: kind.into(),
        text: last_lines(text, 8),
    })
}

/// Pure: the last `count` lines with something on them.
pub fn last_lines(screen: &str, count: usize) -> String {
    let lines: Vec<&str> = screen
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_connected_server_and_its_page() {
        let text =
            "Remote Control\n\n· Connected · https://claude.ai/code?environment=env_01ab\n\n";
        assert_eq!(
            read(text),
            Screen::Connected {
                url: Some("https://claude.ai/code?environment=env_01ab".into())
            }
        );
        assert_eq!(attention(&read(text), text), None);
    }

    #[test]
    fn a_disconnect_is_not_connected() {
        assert_eq!(read("Remote Control\n● Disconnected\n"), Screen::Starting);
    }

    #[test]
    fn reads_the_trust_question_and_whether_it_pre_approves() {
        let plain = "Quick safety check: is this a folder you trust?\nTrust /Users/m/code? [y/N]";
        assert_eq!(read(plain), Screen::TrustQuestion { preapproves: false });
        let risky =
            "Quick safety check\nIt pre-approves 3 tool permissions\nTrust /Users/m/code? [y/N]";
        assert_eq!(read(risky), Screen::TrustQuestion { preapproves: true });
        assert_eq!(
            attention(&read(risky), risky).unwrap().kind,
            "trustPermissions"
        );
    }

    #[test]
    fn leaves_enabling_remote_control_to_a_person() {
        let text = "Enable Remote Control? (y/n)";
        assert_eq!(read(text), Screen::EnableQuestion);
        assert_eq!(attention(&read(text), text).unwrap().kind, "waiting");
    }

    #[test]
    fn keeps_the_last_lines_with_text() {
        assert_eq!(last_lines("a\n\nb\n  \nc\n", 2), "b\nc");
        assert_eq!(last_lines("", 3), "");
    }
}
