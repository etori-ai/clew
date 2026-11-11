-- The external MCP chat-services exploration (D81) is withdrawn: its three tables held synthetic development
-- registrations, deliveries and decisions only. Audit rows written by the exploration stay in `audit`.
DROP TABLE "mcp_connection" CASCADE;--> statement-breakpoint
DROP TABLE "mcp_decision" CASCADE;--> statement-breakpoint
DROP TABLE "mcp_delivery" CASCADE;
