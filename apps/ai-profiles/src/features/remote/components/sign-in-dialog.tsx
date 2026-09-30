import type { AppError, LoginStart, RemoteAccount, RemoteHost } from '@/lib/types'

import { useEffect, useRef, useState } from 'react'

import { ExternalLink, RotateCw } from 'lucide-react'

import { Button, Dialog, Kbd, useToast } from '@/design'
import { Input } from '@/design/ui/input'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { openExternalUrl } from '@/lib/commands'

import { useRemoteSignIn } from '../api/use-remote'

type Props = {
  open: boolean
  host: RemoteHost
  account: string
  /** What Cancel says: "Skip for now" straight after making the profile. */
  cancelLabel?: string
  /** Instead of the usual title, "Sign in <profile>". */
  title?: string
  /** Signed in: the caller says so instead of the usual toast. */
  onSignedIn?: (signed: RemoteAccount) => void
  onClose: () => void
}

/** The host's sign-in is over after these: only starting again helps. */
const endedCodes = new Set(['login_failed', 'login_expired'])

/**
 * Pure: whether `error`, from handing over the code, ended the host's
 * sign-in, so that only starting again helps.
 */
function endsSignIn(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? (error as AppError).code : undefined
  return endedCodes.has(code ?? '')
}

/**
 * Pure: whether there is a code to hand over, to a sign-in that is still on.
 */
function codeReady(login: LoginStart | null, code: string, submitting: boolean, ended: boolean): boolean {
  return login !== null && code.trim().length > 0 && !submitting && !ended
}

/**
 * Signing a remote account in from the Mac. The host runs `claude auth
 * login`, its sign-in page opens here in the browser, and the code the page
 * shows is pasted back and typed in on the host.
 */
export function SignInDialog({ open, host, account, cancelLabel = 'Cancel', title, onSignedIn, onClose }: Props) {
  const { start, submit, cancel } = useRemoteSignIn(host.id, account)
  const toast = useToast()
  const [login, setLogin] = useState<LoginStart | null>(null)
  const [code, setCode] = useState('')
  const openRef = useRef(open)
  openRef.current = open

  async function begin() {
    setLogin(null)
    setCode('')
    submit.reset()
    try {
      const started = await start.mutateAsync()
      if (openRef.current) {
        setLogin(started)
      } else {
        // Closed while the host was starting it.
        void cancel(started.loginId)
      }
    } catch {
      // Shown below.
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh sign-in each time the dialog opens
  useEffect(() => {
    if (open) {
      start.reset()
      void begin()
    }
  }, [open])

  const submitError = submit.isError ? submit.error : null
  const ended = endsSignIn(submitError)
  const ready = codeReady(login, code, submit.isPending, ended)

  async function handleSubmit() {
    if (!ready || login === null) {
      return
    }
    try {
      const signed = await submit.mutateAsync({ loginId: login.loginId, code: code.trim() })
      setLogin(null)
      if (onSignedIn) {
        onSignedIn(signed)
        return
      }
      const who = signed.account?.email
      toast.success(`Signed in ${account}`, who ? `As ${who}, on ${host.label}.` : `On ${host.label}.`)
      onClose()
    } catch {
      // Shown below.
    }
  }

  function handleClose() {
    if (login !== null && !ended) {
      void cancel(login.loginId)
    }
    setLogin(null)
    onClose()
  }

  return (
    <Dialog
      open={open}
      title={title ?? `Sign in ${account}`}
      description={`On ${host.label}. Sign in in the browser, then paste the code the page shows.`}
      onClose={handleClose}
      onSubmit={handleSubmit}
      closeOnOutsideClick={false}
      foot={
        <SignInFoot
          cancelLabel={cancelLabel}
          ready={ready}
          submitting={submit.isPending}
          onCancel={handleClose}
          onSubmit={handleSubmit}
        />
      }
    >
      <div className="space-y-3 text-body text-ink-soft">
        <SignInStep
          hostLabel={host.label}
          account={account}
          starting={start.isPending}
          startError={start.isError ? start.error : null}
          login={login}
          code={code}
          ended={ended}
          onCodeChange={setCode}
          onRetry={() => void begin()}
        />
        <SubmitProblem error={submitError} ended={ended} onRetry={() => void begin()} />
      </div>
    </Dialog>
  )
}

type SignInFootProps = {
  /**
   * What the cancel button says.
   */
  cancelLabel: string
  /**
   * Whether there is a code to hand over.
   */
  ready: boolean
  /**
   * Whether the code is being handed over now.
   */
  submitting: boolean
  /**
   * Closes, ending the host's sign-in.
   */
  onCancel: () => void
  /**
   * Hands the code over.
   */
  onSubmit: () => void
}

/**
 * The dialog's buttons.
 */
function SignInFoot({ cancelLabel, ready, submitting, onCancel, onSubmit }: SignInFootProps) {
  return (
    <>
      <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} disabled={submitting} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        variant="primary"
        size="sm"
        trailingKbd={<Kbd variant="onOrange">⏎</Kbd>}
        disabled={!ready}
        onClick={onSubmit}
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </>
  )
}

type SignInStepProps = {
  /**
   * What the host is called here.
   */
  hostLabel: string
  /**
   * The profile being signed in.
   */
  account: string
  /**
   * Whether the host is starting its sign-in now.
   */
  starting: boolean
  /**
   * Why the host couldn't start it, if it couldn't.
   */
  startError: unknown
  /**
   * The host's sign-in once started.
   */
  login: LoginStart | null
  /**
   * The code as pasted.
   */
  code: string
  /**
   * Whether the host's sign-in is over, so the code can't be changed.
   */
  ended: boolean
  /**
   * Takes the code as pasted.
   */
  onCodeChange: (code: string) => void
  /**
   * Starts the sign-in again.
   */
  onRetry: () => void
}

/**
 * Where the sign-in is: starting, failed to start, or waiting for the code.
 */
function SignInStep({
  hostLabel,
  account,
  starting,
  startError,
  login,
  code,
  ended,
  onCodeChange,
  onRetry,
}: SignInStepProps) {
  if (starting) {
    return <p className="text-muted">Asking {hostLabel} for a sign-in page…</p>
  }
  if (startError) {
    return <Problem message={sessionErrorMessage(startError, 'Signing in could not start.')} onRetry={onRetry} />
  }
  if (!login) {
    return null
  }
  return (
    <>
      <p>
        The sign-in page is open in your browser. Sign in with the account {account} should use, then copy the code it
        shows.
      </p>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<ExternalLink className="h-3.5 w-3.5" />}
        onClick={() => void openExternalUrl(login.url)}
      >
        Open the page again
      </Button>
      <div>
        <label
          htmlFor="remote-sign-in-code"
          className="mb-1.5 block font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted"
        >
          Code
        </label>
        <Input
          id="remote-sign-in-code"
          value={code}
          autoFocus
          maxLength={512}
          disabled={ended}
          onChange={(event) => onCodeChange(event.target.value)}
          placeholder="Paste the code here"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </>
  )
}

type SubmitProblemProps = {
  /**
   * Why handing over the code failed, if it did.
   */
  error: unknown
  /**
   * Whether that ended the host's sign-in.
   */
  ended: boolean
  /**
   * Starts the sign-in again.
   */
  onRetry: () => void
}

/**
 * Why the code didn't work: with a way to start again once the host's
 * sign-in is over.
 */
function SubmitProblem({ error, ended, onRetry }: SubmitProblemProps) {
  if (!error) {
    return null
  }
  if (ended) {
    return <Problem message={sessionErrorMessage(error)} retryLabel="Sign in again" onRetry={onRetry} />
  }
  return (
    <p role="alert" className="text-meta text-red">
      {sessionErrorMessage(error, 'Signing in did not work.')}
    </p>
  )
}

function Problem({
  message,
  retryLabel = 'Try again',
  onRetry,
}: {
  message: string
  retryLabel?: string
  onRetry: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p role="alert" className="text-meta text-red">
        {message}
      </p>
      <Button variant="ghost" size="sm" leadingIcon={<RotateCw className="h-3.5 w-3.5" />} onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}
