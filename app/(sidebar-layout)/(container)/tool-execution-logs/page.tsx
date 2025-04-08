'use client';

import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { Check, Clock, Filter, RefreshCw, XCircle } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import { useEffect, useState } from 'react';
import useSWR, { mutate } from 'swr';

import { getMcpServers } from '@/app/actions/mcp-servers';
import { updateProfileCapabilities } from '@/app/actions/profiles';
import { getToolExecutionLogs, getToolNames } from '@/app/actions/tool-execution-logs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';
import { Switch } from '@/components/ui/switch';
import { ProfileCapability, ToolExecutionStatus } from '@/db/schema';
import { useProfiles } from '@/hooks/use-profiles';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function ToolExecutionLogsPage() {
    const { currentProfile, mutateActiveProfile } = useProfiles();
    const { toast } = useToast();
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);
    const [filters, setFilters] = useState<{
        mcpServerUuids: string[];
        toolNames: string[];
        statuses: ToolExecutionStatus[];
    }>({
        mcpServerUuids: [],
        toolNames: [],
        statuses: [],
    });
    const [showFilters, setShowFilters] = useState(false);
    const [hasToolLogsEnabled, setHasToolLogsEnabled] = useState(false);

    // Pagination options
    const pageSizeOptions = [10, 20, 30, 50];
    const [selectedPageSize, setSelectedPageSize] = useState(10);

    // Update local state when profile changes
    useEffect(() => {
        if (currentProfile) {
            setHasToolLogsEnabled(
                currentProfile.enabled_capabilities?.includes(ProfileCapability.TOOL_LOGS) || false
            );
        }
    }, [currentProfile]);

    const { data: logsData, mutate: mutateLogs, isLoading } = useSWR(
        currentProfile?.uuid && hasToolLogsEnabled
            ? ['getToolExecutionLogs', page, pageSize, JSON.stringify(filters), currentProfile.uuid, hasToolLogsEnabled]
            : null,
        () => getToolExecutionLogs({
            currentProfileUuid: currentProfile?.uuid || '',
            limit: pageSize,
            offset: page * pageSize,
            ...filters,
        })
    );

    const { data: mcpServers } = useSWR(
        currentProfile?.uuid && hasToolLogsEnabled
            ? ['getMcpServers', currentProfile.uuid]
            : null,
        () => getMcpServers(currentProfile?.uuid || '')
    );

    const { data: toolNames } = useSWR(
        currentProfile?.uuid && hasToolLogsEnabled
            ? ['getToolNames', currentProfile.uuid]
            : null,
        () => getToolNames(currentProfile?.uuid || '')
    );

    const handlePageSizeChange = (newSize: number) => {
        setSelectedPageSize(newSize);
        setPageSize(newSize);
        setPage(0);
    };

    const columnHelper = createColumnHelper<any>();

    const columns = [
        columnHelper.accessor('id', {
            cell: (info) => info.getValue(),
            header: 'ID',
        }),
        columnHelper.accessor('tool_name', {
            cell: (info) => info.getValue(),
            header: 'Tool Name',
        }),
        columnHelper.accessor('mcp_server_name', {
            cell: (info) => info.getValue() || '-',
            header: 'MCP Server',
        }),
        columnHelper.accessor('status', {
            cell: (info) => {
                const status = info.getValue() as ToolExecutionStatus;
                return (
                    <div className="flex items-center">
                        {status === ToolExecutionStatus.SUCCESS && (
                            <Badge variant="outline" className="flex items-center gap-1 text-green-600 bg-green-50 border-green-200">
                                <Check className="h-3 w-3" /> Success
                            </Badge>
                        )}
                        {status === ToolExecutionStatus.ERROR && (
                            <Badge variant="destructive" className="flex items-center gap-1">
                                <XCircle className="h-3 w-3" /> Error
                            </Badge>
                        )}
                        {status === ToolExecutionStatus.PENDING && (
                            <Badge variant="outline" className="flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Pending
                            </Badge>
                        )}
                    </div>
                );
            },
            header: 'Status',
        }),
        columnHelper.accessor('execution_time_ms', {
            cell: (info) => info.getValue() ? `${info.getValue()} ms` : '-',
            header: 'Execution Time',
        }),
        columnHelper.accessor('created_at', {
            cell: (info) => new Date(info.getValue()).toLocaleString(),
            header: 'Created At',
        }),
        columnHelper.accessor('details', {
            cell: (info) => (
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                            View Details
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="min-w-[80vw]">
                        <DialogHeader>
                            <DialogTitle>Execution Details</DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-2 gap-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Payload</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Highlight
                                        theme={themes.github}
                                        code={JSON.stringify(info.row.original.payload, null, 2)}
                                        language="json"
                                    >
                                        {({ tokens, getLineProps, getTokenProps }) => (
                                            <pre className="bg-[#f6f8fa] text-[#24292f] p-4 rounded-md overflow-auto max-h-[400px] whitespace-pre-wrap">
                                                {tokens.map((line, i) => (
                                                    <div key={i} {...getLineProps({ line })}>
                                                        {line.map((token, key) => (
                                                            <span key={key} {...getTokenProps({ token })} />
                                                        ))}
                                                    </div>
                                                ))}
                                            </pre>
                                        )}
                                    </Highlight>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Result</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {info.row.original.result ? (
                                        <Highlight
                                            theme={themes.github}
                                            code={JSON.stringify(info.row.original.result, null, 2)}
                                            language="json"
                                        >
                                            {({ tokens, getLineProps, getTokenProps }) => (
                                                <pre className="bg-[#f6f8fa] text-[#24292f] p-4 rounded-md overflow-auto max-h-[400px] whitespace-pre-wrap">
                                                    {tokens.map((line, i) => (
                                                        <div key={i} {...getLineProps({ line })}>
                                                            {line.map((token, key) => (
                                                                <span key={key} {...getTokenProps({ token })} />
                                                            ))}
                                                        </div>
                                                    ))}
                                                </pre>
                                            )}
                                        </Highlight>
                                    ) : (
                                        <div className="bg-[#f6f8fa] text-[#24292f] p-4 rounded-md">No result data</div>
                                    )}
                                </CardContent>
                            </Card>
                            {info.row.original.error_message && (
                                <Card className="col-span-2">
                                    <CardHeader>
                                        <CardTitle>Error</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <pre className="bg-red-50 text-red-700 p-4 rounded-md overflow-auto max-h-[200px] whitespace-pre-wrap">
                                            {info.row.original.error_message}
                                        </pre>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            ),
            header: 'Details',
        }),
    ];

    const table = useReactTable({
        data: logsData?.logs || [],
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        manualPagination: true,
        pageCount: logsData ? Math.ceil(logsData.total / pageSize) : 0,
    });

    const handleToggleToolLogs = async (checked: boolean) => {
        if (!currentProfile) return;

        const newCapabilities = checked
            ? [...(currentProfile.enabled_capabilities || []), ProfileCapability.TOOL_LOGS]
            : (currentProfile.enabled_capabilities || []).filter((cap) => cap !== ProfileCapability.TOOL_LOGS);

        try {
            await updateProfileCapabilities(currentProfile.uuid, newCapabilities);
            // Update the UI immediately for responsiveness
            setHasToolLogsEnabled(checked);
            // Refresh all data
            await mutateActiveProfile();
            await mutateLogs();
            await mutate(['getMcpServers', currentProfile?.uuid]);
            await mutate(['getToolNames', currentProfile?.uuid]);
            toast({
                description: checked ? "Tool Logs enabled" : "Tool Logs disabled"
            });
        } catch (error) {
            // Revert UI state on error
            setHasToolLogsEnabled(!checked);
            toast({
                variant: "destructive",
                title: "Error updating capabilities",
                description: error instanceof Error ? error.message : "An unknown error occurred"
            });
        }
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold">Tool Execution Logs</h1>
                    <p className="text-muted-foreground mt-2">
                        View and analyze your tool execution history
                    </p>
                </div>
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="tool-logs"
                            checked={hasToolLogsEnabled}
                            onCheckedChange={handleToggleToolLogs}
                        />
                        <Label htmlFor="tool-logs">
                            Enable Tool Logs
                        </Label>
                    </div>
                    {hasToolLogsEnabled && (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => setShowFilters(!showFilters)}
                                className="flex items-center gap-2"
                            >
                                <Filter className="h-4 w-4" />
                                Filters
                            </Button>
                            <Button
                                variant="default"
                                onClick={() => {
                                    mutateLogs();
                                    mutate(['getMcpServers', currentProfile?.uuid]);
                                    mutate(['getToolNames', currentProfile?.uuid]);
                                }}
                                className="flex items-center gap-2"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Refresh
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {!hasToolLogsEnabled ? (
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-muted-foreground">
                            Tool Logs are currently disabled. Enable this feature to view tool execution history.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {showFilters && (
                        <Card className="mb-6">
                            <CardHeader>
                                <CardTitle>Filters</CardTitle>
                                <CardDescription>Filter execution logs by various criteria</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* MCP Servers Filter */}
                                    <div>
                                        <h3 className="font-medium mb-2">MCP Servers</h3>
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                            {mcpServers?.map((server) => (
                                                <div key={server.uuid} className="flex items-center space-x-2">
                                                    <Switch
                                                        id={`server-${server.uuid}`}
                                                        checked={filters.mcpServerUuids.includes(server.uuid)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setFilters({
                                                                    ...filters,
                                                                    mcpServerUuids: [...filters.mcpServerUuids, server.uuid]
                                                                });
                                                            } else {
                                                                setFilters({
                                                                    ...filters,
                                                                    mcpServerUuids: filters.mcpServerUuids.filter(uuid => uuid !== server.uuid)
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    <label
                                                        htmlFor={`server-${server.uuid}`}
                                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                    >
                                                        {server.name}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Tool Names Filter */}
                                    <div>
                                        <h3 className="font-medium mb-2">Tool Names</h3>
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                            {toolNames?.map((toolName) => (
                                                <div key={toolName} className="flex items-center space-x-2">
                                                    <Switch
                                                        id={`tool-${toolName}`}
                                                        checked={filters.toolNames.includes(toolName)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setFilters({
                                                                    ...filters,
                                                                    toolNames: [...filters.toolNames, toolName]
                                                                });
                                                            } else {
                                                                setFilters({
                                                                    ...filters,
                                                                    toolNames: filters.toolNames.filter(name => name !== toolName)
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    <label
                                                        htmlFor={`tool-${toolName}`}
                                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                    >
                                                        {toolName}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Status Filter */}
                                    <div>
                                        <h3 className="font-medium mb-2">Status</h3>
                                        <div className="space-y-2">
                                            {Object.values(ToolExecutionStatus).map((status) => (
                                                <div key={status} className="flex items-center space-x-2">
                                                    <Switch
                                                        id={`status-${status}`}
                                                        checked={filters.statuses.includes(status)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                setFilters({
                                                                    ...filters,
                                                                    statuses: [...filters.statuses, status]
                                                                });
                                                            } else {
                                                                setFilters({
                                                                    ...filters,
                                                                    statuses: filters.statuses.filter(s => s !== status)
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    <label
                                                        htmlFor={`status-${status}`}
                                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                    >
                                                        {status}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end mt-4 space-x-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setFilters({
                                                mcpServerUuids: [],
                                                toolNames: [],
                                                statuses: [],
                                            });
                                        }}
                                    >
                                        Clear All
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardContent className="pt-6">
                            {isLoading ? (
                                <div className="text-center py-4">Loading logs...</div>
                            ) : logsData?.logs.length === 0 ? (
                                <div className="text-center py-4">No logs found</div>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full bg-white border border-gray-300">
                                            <thead>
                                                {table.getHeaderGroups().map((headerGroup) => (
                                                    <tr key={headerGroup.id}>
                                                        {headerGroup.headers.map((header) => (
                                                            <th
                                                                key={header.id}
                                                                className="py-2 px-4 border-b text-left font-semibold bg-gray-100"
                                                            >
                                                                {flexRender(
                                                                    header.column.columnDef.header,
                                                                    header.getContext()
                                                                )}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </thead>
                                            <tbody>
                                                {table.getRowModel().rows.map((row) => (
                                                    <tr key={row.id} className="hover:bg-gray-50">
                                                        {row.getVisibleCells().map((cell) => (
                                                            <td key={cell.id} className="py-2 px-4 border-b">
                                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="flex items-center justify-between mt-4">
                                        <div className="flex items-center space-x-2">
                                            <span className="text-sm text-muted-foreground">
                                                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, logsData?.total || 0)} of {logsData?.total || 0} results
                                            </span>
                                            <div className="relative">
                                                <div className="flex space-x-1">
                                                    {pageSizeOptions.map(size => (
                                                        <Button
                                                            key={size}
                                                            variant={selectedPageSize === size ? "default" : "outline"}
                                                            className="h-8 px-2"
                                                            onClick={() => handlePageSizeChange(size)}
                                                        >
                                                            {size}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <Pagination>
                                            <PaginationContent>
                                                <PaginationItem>
                                                    <PaginationPrevious
                                                        onClick={() => setPage(Math.max(0, page - 1))}
                                                        className={cn(
                                                            "cursor-pointer",
                                                            page === 0 ? "cursor-not-allowed opacity-50" : ""
                                                        )}
                                                    />
                                                </PaginationItem>

                                                {Array.from({ length: Math.min(5, table.getPageCount()) }, (_, i) => {
                                                    let pageIndex = i;

                                                    // Adjust pageIndex for current page positioning
                                                    if (table.getPageCount() > 5) {
                                                        if (page > 1) {
                                                            pageIndex = page - 1 + i;
                                                        }
                                                        if (page > table.getPageCount() - 4) {
                                                            pageIndex = table.getPageCount() - 5 + i;
                                                        }
                                                    }

                                                    if (pageIndex < table.getPageCount()) {
                                                        return (
                                                            <PaginationItem key={pageIndex}>
                                                                <PaginationLink
                                                                    isActive={pageIndex === page}
                                                                    onClick={() => setPage(pageIndex)}
                                                                    className="cursor-pointer"
                                                                >
                                                                    {pageIndex + 1}
                                                                </PaginationLink>
                                                            </PaginationItem>
                                                        );
                                                    }
                                                    return null;
                                                })}

                                                {table.getPageCount() > 5 && page < table.getPageCount() - 3 && (
                                                    <PaginationItem>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                )}

                                                <PaginationItem>
                                                    <PaginationNext
                                                        onClick={() => setPage(Math.min(table.getPageCount() - 1, page + 1))}
                                                        className={cn(
                                                            "cursor-pointer",
                                                            page >= table.getPageCount() - 1 ? "cursor-not-allowed opacity-50" : ""
                                                        )}
                                                    />
                                                </PaginationItem>
                                            </PaginationContent>
                                        </Pagination>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
} 