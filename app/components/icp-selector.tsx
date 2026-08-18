"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ICPSelectorOption = {
  id: number;
  name: string;
};

export function ICPSelector({
  options,
  selectedICPId,
}: {
  options: ICPSelectorOption[];
  selectedICPId?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectICP(id: string) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("icp", id);
    router.push(`${pathname}?${nextSearchParams.toString()}`);
  }

  return (
    <select
      name="icpId"
      value={selectedICPId}
      onChange={(event) => selectICP(event.target.value)}
    >
      {options.map((option) => (
        <option value={option.id} key={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
