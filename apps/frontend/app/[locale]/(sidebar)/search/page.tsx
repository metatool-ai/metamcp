"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";

import { SearchSkeleton } from "@/components/skeletons/search-skeleton";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/hooks/useLocale";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath } from "@/lib/i18n";
import type { PaginatedSearchResult } from "@/types/search";

import CardGrid from "./components/CardGrid";
import { PaginationUi } from "./components/PaginationUi";

const PAGE_SIZE = 6;

function SearchContent() {
  const { t } = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const query = searchParams.get("query") || "";
  const offset = parseInt(searchParams.get("offset") || "0");
  const [searchQuery, setSearchQuery] = useState(query);

  const { data, error, isLoading } = useQuery<PaginatedSearchResult>({
    queryKey: ["search", query, offset],
    queryFn: async () => {
      const res = await fetch(
        `/service/search?query=${encodeURIComponent(query)}&pageSize=${PAGE_SIZE}&offset=${offset}`,
      );
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to fetch: ${res.status} ${res.statusText} - ${errorText}`,
        );
      }
      return res.json();
    },
  });

  if (error) console.error("Search error:", error);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== query) {
        const params = new URLSearchParams();
        if (searchQuery) params.set("query", searchQuery);
        params.set("offset", "0");
        const searchPath = getLocalizedPath("/search", locale);
        router.push(`${searchPath}?${params.toString()}`);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, query, router, locale]);

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("offset", ((page - 1) * PAGE_SIZE).toString());
    const searchPath = getLocalizedPath("/search", locale);
    router.push(`${searchPath}?${params.toString()}`);
  };

  if (isLoading) {
    return <SearchSkeleton />;
  }

  return (
    <div className="container mx-auto py-8 space-y-6 flex flex-col items-center">
      <h1 className="text-2xl font-bold">{t("search:title")}</h1>
      <Input
        type="search"
        placeholder={t("search:searchPlaceholder")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-xl mx-auto"
      />

      {error && (
        <div>
          {t("search:error")}:{" "}
          {error.message +
            " | You may need a proxy server to access Cloudflare."}
        </div>
      )}
      {data?.results && <CardGrid items={data.results} />}

      {data && (
        <PaginationUi
          currentPage={Math.floor(offset / PAGE_SIZE) + 1}
          totalPages={Math.ceil(data.total / PAGE_SIZE)}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchContent />
    </Suspense>
  );
}
