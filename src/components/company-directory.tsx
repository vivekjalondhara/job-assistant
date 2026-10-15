"use client";
import { useEffect, useState } from "react";
import { Check, Mail, Plus, RefreshCw, Search } from "lucide-react";
import type { AppState, Company } from "@/lib/types";
import type { CompanyPage } from "@/lib/companies";
import { readJsonResponse } from "@/lib/http-client";
import type { Act } from "./workspace";
import { Badge, Button, Empty, label } from "./ui";

export function CompanyDirectory({
  data,
  busy,
  act,
  onEdit,
}: {
  data: AppState;
  busy: string;
  act: Act;
  onEdit: (company: Company | "new") => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CompanyPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const value = await readJsonResponse<CompanyPage>(
          await fetch(`/api/companies?q=${encodeURIComponent(search)}&page=${page}`, {
            signal: controller.signal,
            cache: "no-store",
          }),
        );
        setResult(value);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load companies.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, page, data]);
  const companies = result?.companies || [];
  return (
    <>
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search companies"
            placeholder="Find a company"
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Button
          busy={busy === "company.scan"}
          disabled={!!busy || !data.companyCount}
          onClick={() => act("company.scan")}
        >
          <RefreshCw size={15} /> Check all companies
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!result && loading ? (
        <p role="status">Loading companies…</p>
      ) : !companies.length ? (
        <div className="panel">
          <Empty
            title={search ? "No matching companies" : "Where would you love to work?"}
            description={
              search
                ? "Try another company name."
                : "Add your first company or import your company list."
            }
          >
            {!search && (
              <Button onClick={() => onEdit("new")}>
                <Plus size={16} /> Add company
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <div className="company-grid" aria-busy={loading}>
          {companies.map((company) => (
            <article className="company-card" key={company.id}>
              <div className="company-card-top">
                <span className="company-avatar large">
                  {company.name.slice(0, 2).toUpperCase()}
                </span>
                <Badge
                  tone={
                    company.paused
                      ? "amber"
                      : company.checkStatus === "success"
                        ? "green"
                        : company.checkStatus === "failed"
                          ? "red"
                          : "neutral"
                  }
                >
                  {company.paused
                    ? "Paused"
                    : company.checkStatus === "never"
                      ? "Ready to check"
                      : label(company.checkStatus)}
                </Badge>
              </div>
              <h2>{company.name}</h2>
              <p className="company-domain">
                {company.website ? new URL(company.website).hostname : "Website not added"}
              </p>
              <div className="company-facts">
                <span>
                  {
                    data.jobs.filter(
                      (job) => job.companyId === company.id && job.status !== "closed",
                    ).length
                  }{" "}
                  roles saved
                </span>
                <span>{company.source === "manual" ? "Manual source" : label(company.source)}</span>
              </div>
              <p className="company-note">
                {company.checkNote || "Check the careers page for current opportunities."}
              </p>
              <div className="company-contact">
                <Mail size={14} />
                <span>{company.email || "Recruitment contact not added"}</span>
                {company.contactConfirmed && <Check size={14} />}
              </div>
              <footer>
                <button className="inline-link" onClick={() => onEdit(company)}>
                  Edit company
                </button>
                <button
                  className="icon-btn bordered"
                  disabled={!!busy || company.paused}
                  aria-label={`Check ${company.name}`}
                  onClick={() => act("company.scan", { id: company.id })}
                >
                  <RefreshCw size={15} />
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {!!result?.total && (
        <nav className="company-pagination" aria-label="Company pages">
          <span className="small">
            {((result.page - 1) * result.pageSize + 1).toLocaleString()}–
            {Math.min(result.page * result.pageSize, result.total).toLocaleString()} of{" "}
            {result.total.toLocaleString()} companies
          </span>
          <div className="button-row">
            <Button disabled={loading || result.page <= 1} onClick={() => setPage(result.page - 1)}>
              Previous
            </Button>
            <Button
              disabled={loading || result.page * result.pageSize >= result.total}
              onClick={() => setPage(result.page + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}
