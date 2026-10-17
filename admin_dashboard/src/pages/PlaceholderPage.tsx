interface Props {
  title: string;
  detail: string;
}

export default function PlaceholderPage({ title, detail }: Props) {
  return (
    <div>
      <h1>{title}</h1>

      <section className="panel">
        <p>{detail}</p>
        <p className="subtle">Feature scheduled for a later phase.</p>
      </section>
    </div>
  );
}