# MetaMCP Documentation

This directory contains documentation for the MetaMCP system and its available tools.

## Files

- **`mcp-tools-guide.md`** - Comprehensive guide for AI agents on how to use MCP tools
- **`mcp-tools-config.yaml`** - Quick reference configuration for tool selection and parameters

## Quick Start for AI Agents

1. **Read the guide**: Start with `mcp-tools-guide.md` for detailed information
2. **Check config**: Use `mcp-tools-config.yaml` for quick parameter reference
3. **Follow the rules**: Use the tool selection rules to choose the right tool
4. **Validate first**: Check parameters before making requests
5. **Use templates**: Start with provided request templates

## Available MCP Tools

### Google Analytics Tools
- `mcp_metamcp-oceanx_google-analytics-mcp__run_report` - Standard GA4 reports
- `mcp_metamcp-oceanx_google-analytics-mcp__run_realtime_report` - Live traffic monitoring

### Data Warehouse Tool
- `mcp_metamcp-oceanx_ox-staging-dwh__query` - SQL queries on OceanX staging DWH

## Key Points

- **Property ID**: Always use `383528775` for Google Analytics
- **Common Mistakes**: `users` → `newUsers`, `pageviews` → `screenPageViews`
- **Tool Selection**: Use keywords to determine the right tool
- **Validation**: Always validate parameters before making requests

## Maintenance

Update these files when:
- New MCP tools are added
- Tool parameters change
- New common mistakes are discovered
- Request templates need updates