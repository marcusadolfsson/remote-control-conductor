import type { ReactNode } from 'react'
import type { MemoryDecision, TransferMemoryFile } from '@/lib/types'

import { useState } from 'react'

import { Button, cn } from '@/design'

import { sessionErrorMessage } from './session-error-message'

/** How a memory conflict is to be settled: `newer` until the user picks. */
export type MemoryChoice = 'newer' | 'source' | 'destination' | { merged: string }

/** The decisions a move is sent with: one per memory conflict. */
export function memoryDecisions(
  memory: Array<TransferMemoryFile>,
  choices: Record<string, MemoryChoice>,
): Record<string, MemoryDecision> {
  const out: Record<string, MemoryDecision> = {}
  for (const file of memory) {
    if (file.action !== 'conflict') {
      continue
    }
    const choice = choices[file.path] ?? 'newer'
    if (typeof choice === 'object') {
      out[file.path] = { take: 'merged', text: choice.merged }
    } else {
      out[file.path] = { take: choice === 'newer' ? file.newer : choice }
    }
  }
  return out
}

type Props = {
  memory: Array<TransferMemoryFile>
  source: string
  destination: string
  choices: Record<string, MemoryChoice>
  onChoice: (path: string, choice: MemoryChoice) => void
  /** Claude's merge of the note at `path`, for the user to accept or not. */
  merge: (path: string) => Promise<string>
}

/**
 * A move's project memory, the way claudemulti merges it: the notes both
 * profiles changed first, each to decide, then what happens by itself.
 */
export function ProjectMemory({ memory, source, destination, choices, onChoice, merge }: Props) {
  const shown = memory.filter((file) => file.action !== 'same')
  const decisions = shown.filter((file) => file.action === 'conflict')
  const automatic = shown.filter((file) => file.action !== 'conflict')
  if (shown.length === 0) {
    return null
  }
  return (
    <div className="space-y-1.5">
      <p className="text-meta text-ink-soft">Project memory</p>
      {decisions.length > 0 ? (
        <ul className="space-y-1.5">
          {decisions.map((file) => (
            <MemoryConflict
              key={file.path}
              file={file}
              source={source}
              destination={destination}
              choice={choices[file.path] ?? 'newer'}
              onChoice={(choice) => onChoice(file.path, choice)}
              merge={() => merge(file.path)}
            />
          ))}
        </ul>
      ) : null}
      {automatic.length > 0 ? (
        <ul className={decisions.length > 0 ? 'space-y-0.5 pt-1.5' : 'space-y-0.5'}>
          {automatic.map((file) => (
            <li key={file.path} className="font-mono text-mono text-muted-strong">
              {memoryLabel[file.action]} memory/{file.path}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const memoryLabel: Record<TransferMemoryFile['action'], string> = {
  add: 'add   ',
  same: 'same  ',
  index: 'index ',
  merge: 'merge ',
  conflict: 'decide',
}

/**
 * A note both profiles changed. claudemulti's choices: keep the newer, take
 * one side, or have Claude merge them, which is shown before it's used.
 */
function MemoryConflict({
  file,
  source,
  destination,
  choice,
  onChoice,
  merge,
}: {
  file: TransferMemoryFile
  source: string
  destination: string
  choice: MemoryChoice
  onChoice: (choice: MemoryChoice) => void
  merge: () => Promise<string>
}) {
  const [showing, setShowing] = useState(false)
  // Claude's merge, kept once it's written: choosing it again uses it rather
  // than asking again. Discard drops it.
  const [proposal, setProposal] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<unknown>(null)
  const newerName = file.newer === 'source' ? source : destination
  const options: Array<{ value: Exclude<MemoryChoice, { merged: string }>; label: string }> = [
    { value: 'newer', label: `Keep newer (${newerName})` },
    { value: 'source', label: `${source}'s` },
    { value: 'destination', label: `${destination}'s` },
  ]

  async function askClaude() {
    setMergeError(null)
    setMerging(true)
    try {
      const merged = await merge()
      setProposal(merged)
      // Chosen, as it was asked for; shown below, to read or discard.
      onChoice({ merged })
    } catch (caught) {
      setMergeError(caught)
    } finally {
      setMerging(false)
    }
  }

  const merged = typeof choice === 'object' ? choice.merged : null

  return (
    <li className="space-y-1.5 rounded-[8px] border border-border-soft px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-mono text-ink">memory/{file.path}</span>
        <button
          type="button"
          className="cursor-pointer text-meta text-muted-strong underline"
          onClick={() => setShowing((value) => !value)}
        >
          {showing ? 'Hide' : 'Show both'}
        </button>
      </div>
      <p className="text-meta text-muted">Both profiles changed it.</p>
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">{`What to keep of ${file.path}`}</legend>
        {options.map((option) => (
          <ChoiceButton
            key={option.value}
            // Not while Claude merges: the choice would change under it.
            pressed={!merging && choice === option.value}
            disabled={merging}
            onClick={() => onChoice(option.value)}
          >
            {option.label}
          </ChoiceButton>
        ))}
        <ChoiceButton
          pressed={merging || merged !== null}
          disabled={merging}
          onClick={() => {
            if (proposal === null) {
              void askClaude()
            } else {
              onChoice({ merged: proposal })
            }
          }}
        >
          {mergeLabel(merging, proposal !== null)}
        </ChoiceButton>
      </fieldset>
      <MergeError error={mergeError} />
      <MergedText
        merged={merged}
        onDiscard={() => {
          setProposal(null)
          onChoice('newer')
        }}
      />
      <BothTexts
        shown={showing}
        source={source}
        destination={destination}
        sourceText={file.sourceText ?? ''}
        destinationText={file.destinationText ?? ''}
      />
    </li>
  )
}

/**
 * Pure: what the merge button says: while Claude merges, once it has, or
 * before it's asked.
 */
function mergeLabel(merging: boolean, merged: boolean): string {
  if (merging) {
    return 'Claude is merging…'
  }
  return merged ? 'Claude’s merge' : 'Merge with Claude'
}

type ChoiceButtonProps = {
  /**
   * Whether this is the choice made.
   */
  pressed: boolean
  /**
   * Whether it can't be chosen now.
   */
  disabled: boolean
  /**
   * Makes the choice.
   */
  onClick: () => void
  children: ReactNode
}

/**
 * One way to settle a note both profiles changed, lit when it's the one
 * chosen.
 */
function ChoiceButton({ pressed, disabled, onClick, children }: ChoiceButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(
        'cursor-pointer rounded-[6px] border px-2 py-0.5 text-meta',
        pressed ? 'border-orange text-ink' : 'border-border-soft text-muted-strong',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * Why Claude's merge failed, if it did.
 */
function MergeError({ error }: { error: unknown }) {
  if (error === null) {
    return null
  }
  return (
    <p role="alert" className="text-meta text-red">
      {sessionErrorMessage(error, 'The merge failed; choose another option.')}
    </p>
  )
}

/**
 * Claude's merge, while it's the choice, to read before it's used or discard.
 */
function MergedText({ merged, onDiscard }: { merged: string | null; onDiscard: () => void }) {
  if (merged === null) {
    return null
  }
  return (
    <div className="space-y-1.5">
      <Text label="Claude’s merge" text={merged} />
      <Button variant="ghost" size="sm" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  )
}

type BothTextsProps = {
  /**
   * Whether the user asked to see them.
   */
  shown: boolean
  /**
   * The profile the session comes from.
   */
  source: string
  /**
   * The profile it goes to.
   */
  destination: string
  /**
   * The note as the source has it.
   */
  sourceText: string
  /**
   * The note as the destination has it now.
   */
  destinationText: string
}

/**
 * Both profiles' versions of the note, side by side, when asked for.
 */
function BothTexts({ shown, source, destination, sourceText, destinationText }: BothTextsProps) {
  if (!shown) {
    return null
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Text label={`${destination} (now)`} text={destinationText} />
      <Text label={source} text={sourceText} />
    </div>
  )
}

function Text({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-meta text-muted">{label}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[6px] bg-black/[0.03] p-2 font-mono text-[11px] text-ink-soft dark:bg-white/[0.04]">
        {text}
      </pre>
    </div>
  )
}
