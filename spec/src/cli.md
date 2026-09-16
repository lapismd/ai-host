# Operator boundary

The standalone operator CLI has moved to sibling `ai-controller`. Applications
use its shared SDK; operators run `lapis-ai-controller`. Existing ai-host service
installations require an explicit operator migration, not an automatic takeover.

## Requirements

| ID         | Requirement                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-OPS-001 | This transport package MUST NOT ship an operator CLI, executable build workflow or user-service lifecycle. The private MCP shim MAY remain an implementation helper and MUST be callable by an embedding executable. |
