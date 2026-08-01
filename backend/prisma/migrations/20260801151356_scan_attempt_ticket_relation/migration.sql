-- AddForeignKey
ALTER TABLE "scan_attempts" ADD CONSTRAINT "scan_attempts_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
