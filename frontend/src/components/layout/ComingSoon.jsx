import Card from "../ui/Card.jsx";

export default function ComingSoon({ title, description }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
      <Card>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
      </Card>
    </div>
  );
}
