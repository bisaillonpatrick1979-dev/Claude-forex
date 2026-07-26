export function EntetePage({ titre, description }: { titre: string; description: string }) {
  return (
    <div className="mb-3">
      <h1 className="text-base font-semibold">{titre}</h1>
      <p className="mt-0.5 text-xs text-texte-attenue">{description}</p>
    </div>
  );
}
