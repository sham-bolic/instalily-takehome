import { Dashboard } from "./components/dashboard.tsx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const query = await searchParams;
  return (
    <Dashboard
      requestedICPId={positiveInteger(query.icp)}
      showICPBuilder={query["new-icp"] === "1"}
      error={single(query.error)}
    />
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | string[] | undefined): number | undefined {
  const parsed = Number(single(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
