import { NewProjectForm } from "./NewProjectForm";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">New release rail</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Define the acceptance rail</h1>
      <p className="mt-3 text-sm text-titanium">
        Set the builder, the total contract value, and every gate the release must pass. Gate payment
        percentages must sum to exactly 100% and are sealed once you lock the definition — before any GEN is
        funded.
      </p>
      <div className="mt-10">
        <NewProjectForm />
      </div>
    </div>
  );
}
