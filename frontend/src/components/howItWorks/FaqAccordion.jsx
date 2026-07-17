import { useState } from "react";
import Accordion from "../ui/Accordion.jsx";

// Acordeón de preguntas frecuentes. Reutiliza el componente genérico
// components/ui/Accordion.jsx (el mismo que usa el wizard de eventos) en vez
// de reimplementar la lógica de expandir/colapsar.
export default function FaqAccordion({ items }) {
  const [expandedIndex, setExpandedIndex] = useState(null);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <Accordion
          key={item.question}
          title={item.question}
          expanded={expandedIndex === index}
          onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
        >
          <p className="text-sm text-slate-400">{item.answer}</p>
        </Accordion>
      ))}
    </div>
  );
}
