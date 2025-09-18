"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import * as React from "react";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { useTranslations } from "@/hooks/useTranslations";

interface PaginationUiProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PaginationUi({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationUiProps) {
  const { t } = useTranslations();
  const showEllipsisStart = currentPage > 3;
  const showEllipsisEnd = currentPage < totalPages - 2;

  const getPageNumbers = () => {
    const pages: number[] = [];

    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    // Always show first page
    pages.push(1);

    if (showEllipsisStart) {
      pages.push(-1); // -1 represents ellipsis
    }

    // Show current page and surrounding pages
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    ) {
      pages.push(i);
    }

    if (showEllipsisEnd) {
      pages.push(-1); // -1 represents ellipsis
    }

    // Always show last page
    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  // Create localized pagination components
  const LocalizedPaginationPrevious = ({
    onClick,
    ...props
  }: React.ComponentProps<typeof PaginationLink>) => (
    <PaginationLink
      aria-label={t("common:pagination.goToPage", { page: currentPage - 1 })}
      size="default"
      className="gap-1 px-2.5 sm:pl-2.5"
      onClick={onClick}
      {...props}
    >
      <ChevronLeftIcon />
      <span className="hidden sm:block">{t("common:pagination.previous")}</span>
    </PaginationLink>
  );

  const LocalizedPaginationNext = ({
    onClick,
    ...props
  }: React.ComponentProps<typeof PaginationLink>) => (
    <PaginationLink
      aria-label={t("common:pagination.goToPage", { page: currentPage + 1 })}
      size="default"
      className="gap-1 px-2.5 sm:pr-2.5"
      onClick={onClick}
      {...props}
    >
      <span className="hidden sm:block">{t("common:pagination.next")}</span>
      <ChevronRightIcon />
    </PaginationLink>
  );

  const LocalizedPaginationEllipsis = () => (
    <span aria-hidden className="flex size-9 items-center justify-center">
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">{t("common:pagination.morePages")}</span>
    </span>
  );

  return (
    <Pagination className="justify-center">
      <PaginationContent>
        <PaginationItem>
          <LocalizedPaginationPrevious
            href="#"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              if (currentPage > 1) onPageChange(currentPage - 1);
            }}
          />
        </PaginationItem>

        {getPageNumbers().map((pageNum, idx) =>
          pageNum === -1 ? (
            <PaginationItem key={`ellipsis-${idx}`}>
              <LocalizedPaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={pageNum}>
              <PaginationLink
                href="#"
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  onPageChange(pageNum);
                }}
                isActive={pageNum === currentPage}
                aria-label={t("common:pagination.goToPage", { page: pageNum })}
              >
                {pageNum}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <LocalizedPaginationNext
            href="#"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              if (currentPage < totalPages) onPageChange(currentPage + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
