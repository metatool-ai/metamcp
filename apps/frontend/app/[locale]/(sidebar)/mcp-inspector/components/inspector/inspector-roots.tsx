"use client";

import { Root } from "@modelcontextprotocol/sdk/types.js";
import {
  AlertTriangle,
  Folder,
  FolderTree,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InspectorRootsProps {
  enabled?: boolean;
}

export function InspectorRoots({ enabled = true }: InspectorRootsProps) {
  const [roots, setRoots] = useState<Root[]>([]);
  const [loading, setLoading] = useState(false);
  const [customRoots, setCustomRoots] = useState<Root[]>([]);
  const [newRootUri, setNewRootUri] = useState("");
  const [newRootName, setNewRootName] = useState("");

  const fetchRoots = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    try {
      // Note: The MCP protocol doesn't have a standard roots/list method
      // The official inspector handles this differently - roots are typically
      // managed through notifications and server capabilities

      // For now, we'll show a placeholder that explains this
      console.log(
        "Roots fetching - this is managed through server notifications",
      );
      setRoots([]);
    } catch (_error) {
      console.log("Roots listing not supported (this is expected)");
      setRoots([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const refreshRoots = () => {
    // Refresh the roots list by calling fetchRoots again
    fetchRoots();
    toast.success("Refreshing roots list");
  };

  const addCustomRoot = () => {
    if (!newRootUri.trim()) {
      toast.error("Please enter a root URI");
      return;
    }

    const newRoot: Root = {
      uri: newRootUri.trim(),
      name: newRootName.trim() || undefined,
    };

    setCustomRoots((prev) => [...prev, newRoot]);
    setNewRootUri("");
    setNewRootName("");
    toast.success(`Added custom root: ${newRoot.uri}`);
  };

  const removeCustomRoot = (index: number) => {
    const root = customRoots[index];
    setCustomRoots((prev) => prev.filter((_, i) => i !== index));
    toast.success(`Removed custom root: ${root?.uri}`);
  };

  // Roots are loaded manually by clicking the button
  // useEffect(() => {
  //   fetchRoots();
  // }, [fetchRoots]);

  const getRootDisplayName = (root: Root) => {
    return root.name || root.uri.split("/").pop() || root.uri;
  };

  const getRootIcon = (uri: string) => {
    if (uri.startsWith("file://")) {
      return Folder;
    }
    return FolderTree;
  };

  const getRootType = (uri: string) => {
    if (uri.startsWith("file://")) return "File System";
    if (uri.startsWith("http://") || uri.startsWith("https://")) return "HTTP";
    if (uri.startsWith("ftp://")) return "FTP";
    if (uri.startsWith("sftp://")) return "SFTP";
    return "Other";
  };

  const allRoots = [...roots, ...customRoots];

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <h4 className="text-sm font-medium">Roots Not Supported</h4>
        <p className="text-xs text-muted-foreground mt-1">
          This MCP server doesn&apos;t support root listing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderTree className="h-5 w-5 text-orange-500" />
          <span className="text-sm font-medium">Roots ({allRoots.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshRoots}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Roots
          </Button>
        </div>
      </div>

      {/* Add Custom Root */}
      <div className="rounded-lg border p-4">
        <h4 className="text-sm font-semibold mb-3">Add Custom Root</h4>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Root URI</label>
            <Input
              value={newRootUri}
              onChange={(e) => setNewRootUri(e.target.value)}
              placeholder="file:///path/to/directory or https://example.com"
              className="text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Name (optional)</label>
            <Input
              value={newRootName}
              onChange={(e) => setNewRootName(e.target.value)}
              placeholder="Friendly name for this root"
              className="text-xs"
            />
          </div>
          <Button
            onClick={addCustomRoot}
            disabled={!newRootUri.trim()}
            size="sm"
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Root
          </Button>
        </div>
      </div>

      {/* Roots List */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Available Roots</h4>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading roots...</div>
        ) : allRoots.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <FolderTree className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <h4 className="text-sm font-medium">No Roots Configured</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Add custom roots above to define accessible paths for the MCP
              server.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {allRoots.map((root, index) => {
              const RootIcon = getRootIcon(root.uri);
              const isCustom = index >= roots.length;
              return (
                <div
                  key={`${root.uri}-${index}`}
                  className="border rounded-lg p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <RootIcon className="h-5 w-5 text-orange-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {getRootDisplayName(root)}
                        </span>
                        {root.name && root.name !== root.uri && (
                          <span className="text-xs text-muted-foreground bg-gray-100 px-2 py-1 rounded">
                            Named
                          </span>
                        )}
                        {isCustom && (
                          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                            Custom
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {root.uri}
                      </div>

                      {/* Additional info based on URI type */}
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Type: {getRootType(root.uri)}</span>
                        {root.uri.startsWith("file://") && (
                          <span>Path: {root.uri.replace("file://", "")}</span>
                        )}
                        {(root.uri.startsWith("http://") ||
                          root.uri.startsWith("https://")) && (
                          <span>Domain: {new URL(root.uri).hostname}</span>
                        )}
                      </div>
                    </div>

                    {isCustom && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeCustomRoot(index - roots.length)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="rounded-lg bg-orange-50 border border-orange-200 p-4">
        <div className="flex items-start gap-3">
          <FolderTree className="h-5 w-5 text-orange-500 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-orange-900 mb-1">
              About Roots
            </h4>
            <p className="text-xs text-orange-700 mb-2">
              Roots represent the base directories or paths that the MCP server
              can access. These define the scope of resources and operations
              that the server can perform.
            </p>
            <p className="text-xs text-orange-700">
              <strong>Note:</strong> The MCP protocol handles roots through
              server notifications and capabilities rather than a standard list
              method. The roots shown here are for demonstration and testing
              purposes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
