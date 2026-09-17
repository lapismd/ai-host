# Operator CLI migration

`ai-host` is now a transport library. Operator commands and user-service
management belong to `lapis-ai-controller`; see the sibling repository's
`docs/cli/reference.md`. No host CLI or service is installed by this package.
The internal MCP stdio helper remains available to embedding executables.
