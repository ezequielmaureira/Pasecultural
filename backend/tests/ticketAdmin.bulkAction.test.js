import test from "node:test";
import assert from "node:assert/strict";
import { buildBulkTicketActionPlan } from "../src/services/ticketAdmin.service.js";

test("buildBulkTicketActionPlan only selects tickets with valid transitions for cancel", () => {
  const tickets = [
    { id: "a", status: "ACTIVE" },
    { id: "b", status: "CANCELLED" },
    { id: "c", status: "USED" },
  ];

  const plan = buildBulkTicketActionPlan({ action: "cancel", tickets, actorId: "organizer-1", reason: null });

  assert.deepEqual(plan.updateIds, ["a"]);
  assert.equal(plan.auditRows.length, 1);
  assert.equal(plan.auditRows[0].ticketId, "a");
  assert.equal(plan.auditRows[0].action, "CANCEL");
});

test("buildBulkTicketActionPlan handles rehabilitate with per-ticket audit actions", () => {
  const tickets = [
    { id: "a", status: "CANCELLED" },
    { id: "b", status: "USED" },
    { id: "c", status: "ACTIVE" },
  ];

  const plan = buildBulkTicketActionPlan({ action: "rehabilitate", tickets, actorId: "organizer-1", reason: "reopen" });

  assert.deepEqual(plan.updateIds, ["a", "b"]);
  assert.deepEqual(plan.auditRows.map((row) => row.action), ["REHABILITATE", "REACTIVATE"]);
  assert.equal(plan.auditRows[0].reason, "reopen");
});

test("buildBulkTicketActionPlan soft deletes all undeleted candidates and skips no-op cases", () => {
  const tickets = [
    { id: "a", status: "ACTIVE" },
    { id: "b", status: "CANCELLED" },
    { id: "c", status: "USED" },
  ];

  const plan = buildBulkTicketActionPlan({ action: "delete", tickets, actorId: "organizer-1", reason: null });

  assert.deepEqual(plan.updateIds, ["a", "b", "c"]);
  assert.equal(plan.auditRows.length, 3);
  assert.deepEqual(plan.auditRows.map((row) => row.action), ["SOFT_DELETE", "SOFT_DELETE", "SOFT_DELETE"]);
});
