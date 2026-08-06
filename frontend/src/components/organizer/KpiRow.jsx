// Layout del "Resumen general": 2 columnas en mobile, N desde tablet (`md`,
// 768px). Envuelto en su propio componente para que agregar/quitar KPIs no
// requiera repetir la grilla responsive en cada pantalla.
//
// `columns` es opcional (default 4, igual que siempre — el Dashboard no
// cambia). Mapa fijo en vez de interpolar la clase: Tailwind necesita ver
// el nombre completo de la clase en el código para generarla.
const COLUMN_CLASSES = {
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
};

export default function KpiRow({ children, columns = 4 }) {
  return <div className={`grid grid-cols-2 gap-4 ${COLUMN_CLASSES[columns] ?? COLUMN_CLASSES[4]}`}>{children}</div>;
}
