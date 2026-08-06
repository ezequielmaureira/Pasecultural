// Layout del "Resumen general": 2 columnas en mobile, 4 en desktop. Envuelto
// en su propio componente para que agregar/quitar KPIs en próximas
// iteraciones no requiera repetir la grilla responsive en cada pantalla.
export default function KpiRow({ children }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}
