"use client";

import { useRef, useState } from "react";

import type { PersonalizedOutreachView } from "../lib/dashboard-data.ts";

export function OutreachMessage({
  personName,
  outreach,
}: {
  personName: string;
  outreach: PersonalizedOutreachView;
}) {
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    const message = messageRef.current?.value ?? outreach.message;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <section className="outreachMessage" aria-label={`Outreach for ${personName}`}>
      <div className="outreachMessageHeader">
        <div>
          <span className={`outreachConfidence ${outreach.confidence}`}>
            {outreach.confidence} confidence
          </span>
          <strong>Personalized outreach</strong>
        </div>
        <button className="copyMessageButton" type="button" onClick={copyMessage}>
          {copied ? "Copied" : "Copy message"}
        </button>
      </div>
      <textarea
        ref={messageRef}
        aria-label={`Editable outreach message for ${personName}`}
        defaultValue={outreach.message}
        rows={5}
      />
      <div className="outreachRationaleGrid">
        <div>
          <span>Why this person</span>
          <p>{outreach.whyThisPerson}</p>
        </div>
        <div>
          <span>Why this company</span>
          <p>{outreach.whyThisCompany}</p>
        </div>
      </div>
      <details className="outreachEvidence">
        <summary>
          Evidence used <span>{outreach.evidence.length + 1}</span>
        </summary>
        <ul>
          {outreach.evidence.map((evidence) => (
            <li key={evidence.id}>
              <a href={evidence.url} target="_blank" rel="noreferrer">
                {evidence.title} ↗
              </a>
              <p>{evidence.excerpt}</p>
            </li>
          ))}
          <li>
            <a
              href={outreach.productClaimSourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              DuPont product claim ↗
            </a>
            <p>{outreach.productClaim}</p>
          </li>
        </ul>
      </details>
      {outreach.warnings.length ? (
        <div className="outreachWarnings">
          {outreach.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
