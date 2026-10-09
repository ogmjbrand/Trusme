import { Wordmark } from "@/components/shell/brand";
import { Notice } from "@/components/ui/misc";

export const metadata = { title: "Setup required" };

export default function SetupPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Wordmark />
      <h1 className="mt-8 text-2xl font-semibold">Setup required</h1>
      <Notice tone="warning" className="mt-4" title="Supabase is not configured">
        Set <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in the server environment, apply the migrations in <code>supabase/migrations</code>, then restart. See <code>docs/DEPLOYMENT.md</code>.
      </Notice>
    </div>
  );
}
