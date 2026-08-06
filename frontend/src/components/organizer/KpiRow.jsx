// Layout del "Resumen general": 2 columnas en mobile, 4 desde tablet (`md`,
// 768px) — 4 tarjetas compactas entran cómodas a ese ancho, no hace falta
// esperar a `lg` como antes (eso dejaba tablets en un 2x2 con espacio de
// sobra). Envuelto en su propio componente para que agregar/quitar KPIs en
// próximas iteraciones no requiera repetir la grilla responsive.
export default function KpiRow({ children }) {
  return <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{children}</div>;
}
