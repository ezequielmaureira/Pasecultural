// node --test tests/ — sin dependencias nuevas (node:test nativo).
import test from "node:test";
import assert from "node:assert/strict";
import { selectRevenue, buildEventStatsKpis } from "../src/components/organizer/functionStatsSelectors.js";

const sales = [
  { functionId: "f1", status: "CONFIRMED", total: 2300, ticketsSubtotal: 2000, serviceFee: 300, revenue: { netRevenue: 2000 } },
  { functionId: "f1", status: "CONFIRMED", total: 1150, ticketsSubtotal: 1000, serviceFee: 150, revenue: { netRevenue: 0, reversed: true } },
  { functionId: "f2", status: "CONFIRMED", total: 500, ticketsSubtotal: null, serviceFee: null, revenue: { netRevenue: 500 } },
  { functionId: "f1", status: "PENDING", total: 9999, ticketsSubtotal: 9000, revenue: { netRevenue: 0 } },
];

test("REV-FE-A: la recaudación suma netRevenue — sin cargo Smarticket, sin reembolsadas, sin pendientes", () => {
  assert.equal(selectRevenue(sales, "ALL"), 2500);
  assert.equal(selectRevenue(sales, "f1"), 2000);
  assert.equal(selectRevenue(sales, "f2"), 500);
});

test("REV-FE-B: respuesta vieja sin `revenue` cae en ticketsSubtotal (nunca en total con cargo)", () => {
  assert.equal(selectRevenue([{ status: "CONFIRMED", total: 1150, ticketsSubtotal: 1000 }], "ALL"), 1000);
  assert.equal(selectRevenue([{ status: "CONFIRMED", total: 700, ticketsSubtotal: null }], "ALL"), 700);
});

test("REV-FE-C: los KPIs usan la misma recaudación", () => {
  const kpis = buildEventStatsKpis({ functionStats: [{ functionId: "f1", capacity: 10, sold: 2, checkedIn: 0 }], sales, functionId: "f1" });
  assert.equal(kpis.revenue, 2000);
});
