export interface McpIndex {
  name: string;
  description: string;
  githubUrl: string | null;
  package_name: string | null;
  command: string;
  args: string[];
  envs: string[];
  github_stars: number | null;
  package_registry: string | null;
  package_download_count: number | null;
}

export interface SearchIndex {
  [key: string]: McpIndex;
}

export interface PaginatedSearchResult {
  results: SearchIndex;
  total: number;
  offset: number;
  pageSize: number;
  hasMore: boolean;
}
