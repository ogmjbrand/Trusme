import Link from "next/link";
import { getUser } from "@/lib/auth/context";
import { Wordmark } from "@/components/shell/brand";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { LinkButton } from "@/components/ui/button";
import { acceptInvitation } from "@/app/app/team/actions";

export const metadata = { title: "Accept invitation", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6"><Wordmark /></div>
      <Card>
        <CardBody className="space-y-4">
          <h1 className="text-lg font-semibold">Join a TrustOS workspace</h1>
          {user ? (
            <>
              <p className="text-sm text-fg-muted">Signed in as {user.email}. The invitation must have been sent to this email address.</p>
              <ActionForm action={acceptInvitation} redirectTo={() => "/app"}>
                <input type="hidden" name="token" value={token} />
                <SubmitButton>Accept invitation</SubmitButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-muted">Sign in or create an account with the invited email address, then return to this link.</p>
              <div className="flex gap-2">
                <LinkButton href={`/login?next=/invite/${token}`}>Sign in</LinkButton>
                <LinkButton href={`/signup?next=/invite/${token}`} variant="secondary">Create account</LinkButton>
              </div>
            </>
          )}
          <Link href="/" className="block text-xs text-fg-subtle hover:text-fg">Back to TrustOS</Link>
        </CardBody>
      </Card>
    </div>
  );
}
