import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "How it works · Gioia",
  description: "A plain-language walkthrough of how the policy analysis works, step by step.",
};

/** One numbered step in a flow. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="pt-0.5">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">How it works</h1>
          <p className="mt-1 text-muted-foreground">
            A plain-language walkthrough — no jargon, just the steps.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/dashboard">Back to app</a>
        </Button>
      </div>

      {/* What this is for */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>What this workspace does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            This tool reads public <strong>policy documents</strong> and helps make sense of how
            policymakers across Europe are responding to the labour-market challenges of the green
            and digital transition (often called the <em>twin transition</em>) — looking at one
            region and one case study (for example, a country&apos;s tourism or transport sector) at a
            time.
          </p>
          <p>
            The guiding question is simply: <strong>what are policymakers actually trying to do</strong>{" "}
            about jobs, skills and fair regional outcomes in this transition — and how do they plan to
            do it?
          </p>
          <p>
            The analysis follows the <strong>Gioia method</strong>, a well-established approach in
            qualitative research that builds understanding from the ground up: it starts from the
            document&apos;s own words and gradually groups them into bigger ideas. The reading and
            grouping is done with the help of AI, and everything is laid out so a researcher can trace
            each conclusion back to the exact quote it came from.
          </p>
        </CardContent>
      </Card>

      {/* Flow A */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Analysing one document</CardTitle>
          <CardDescription>What happens to each PDF you upload.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            <Step n={1} title="Choose where it belongs">
              You pick a region and one of its case studies (for example, <em>Crete · tourism</em>),
              then upload the policy PDFs that belong to it.
            </Step>
            <Step n={2} title="Read the document">
              The tool reads the PDF and pulls out its text. Scanned, image-only PDFs can&apos;t be
              read, so those are turned away with an explanation.
            </Step>
            <Step n={3} title="Skip repeated work">
              If the very same file has already been analysed for this same kind of case study — even
              for a different region — the existing analysis is reused instead of redoing it. Nothing
              is analysed twice.
            </Step>
            <Step n={4} title="Pick out the key passages">
              It selects the most relevant quotes from the document — usually 25 to 40 — focusing on
              labour-market change, skills and reskilling, jobs, how responsibilities are shared
              across levels of government, and the effects on different regions and groups of people.
            </Step>
            <Step n={5} title="Label the ideas">
              Each passage gets one or more short labels that stay close to the document&apos;s own
              wording (and in its original language). These are the building blocks of the analysis.
            </Step>
            <Step n={6} title="Group them into themes">
              Related labels are gathered into broader, clearly-named themes. For a single document,
              the analysis stops here — at the level of themes.
            </Step>
            <Step n={7} title="Write it up">
              Finally it produces a short, plain-language summary of the policy, notes on how the
              coding was done, and flags for things worth attention — tensions, gaps, or places where
              big ambitions lack concrete plans.
            </Step>
          </ol>
        </CardContent>
      </Card>

      {/* Flow B */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Seeing the big picture</CardTitle>
          <CardDescription>Bringing a whole case study&apos;s files together.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            A single document only tells part of the story. Once <strong>all</strong> the files for a
            case study have been analysed, anyone with access to that case study — the partner who owns
            the region, or an administrator — runs one more step with a single click. It looks across
            every file in that case study at once and groups the themes into a small set of overarching
            patterns — the <strong>big-picture dimensions</strong> of what policymakers in that region
            and sector are really trying to achieve.
          </p>
          <p>
            This step is kept separate and run on demand — deliberately. It reflects the{" "}
            <em>full</em> set of files, and isn&apos;t wastefully repeated after every single upload.
          </p>
          <p>
            If files are later added to or removed from the case study, the app notices that this
            big-picture view is out of date and gently prompts for it to be refreshed.
          </p>
        </CardContent>
      </Card>

      {/* The output */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>The result: a codebook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Everything is gathered into a structured <strong>codebook</strong> for each case study — a
            spreadsheet with a page for each level of the analysis: the original passages, the labels,
            the themes, the big-picture dimensions, and the summaries. You can browse it inside the app
            or download it as Excel.
          </p>
          <p>
            Because every theme traces back to a label, and every label back to a real quote in the
            document, the reasoning is fully transparent — you can always see <em>why</em> the tool
            reached a conclusion.
          </p>
        </CardContent>
      </Card>

      {/* Access */}
      <Card>
        <CardHeader>
          <CardTitle>Who sees what</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-muted-foreground">
          Each partner sees only the case studies for the regions they&apos;ve been given access to.
          Administrators can see and manage everything. Accounts are created by an administrator —
          there is no public sign-up.
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        SkillResilience4EU · policy analysis using the Gioia methodology
      </p>
    </main>
  );
}
