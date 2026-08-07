import { BrowserRouter, Routes, Route, Navigate, NavLink, Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';

// ---------------------------------------------------------------------------
// Company-specific values — FILL THESE IN before publishing. They are the only
// place these facts live, so the policies below stay consistent. Anything in
// [brackets] is a placeholder an attorney/officer must confirm.
//
// NOTE: These documents are drafting templates generated for review. They are
// NOT legal advice and MUST be reviewed by counsel before you rely on them.
// The DMCA safe harbor in particular is unavailable until you register a
// Designated Agent with the U.S. Copyright Office (see the DMCA page).
// ---------------------------------------------------------------------------
export const CO = {
  entity: '[Legal Entity Name, LLC]',
  product: 'Dispatch',
  site: '[https://your-domain.example]',
  effective: 'August 7, 2026',
  contactEmail: '[privacy@your-domain.example]',
  legalEmail: '[legal@your-domain.example]',
  postalAddress: '[Street Address, City, State ZIP, USA]',
  governingState: '[State]',
  arbForum: 'the American Arbitration Association (AAA)',
  arbRules: "the AAA's Consumer Arbitration Rules",
  // DMCA designated agent — must match what you register at copyright.gov.
  dmcaAgentName: '[DMCA Designated Agent Name / Title]',
  dmcaEmail: '[dmca@your-domain.example]',
  dmcaPhone: '[+1 (___) ___-____]',
};

// AI subprocessor(s) named in the FTC disclosure + privacy label. Keep in sync
// with what the server actually calls (see lib/ai.js → AI_PROVIDER).
export const AI_SUBPROCESSOR = 'Anthropic, PBC (the “Claude” API)';

const Banner = () => (
  <div className="card" style={{ padding: '10px 14px', margin: '0 0 18px', borderColor: 'var(--warning, #b8860b)', background: 'color-mix(in srgb, var(--warning, #b8860b) 12%, transparent)' }}>
    <strong>Template — review required.</strong>{' '}
    <span className="muted">
      These policies are drafts for review by qualified counsel. Replace every
      <code style={{ margin: '0 3px' }}>[bracketed]</code> placeholder and confirm the
      arbitration, DMCA, and privacy terms fit your business before publishing.
    </span>
  </div>
);

const P = (props) => <p style={{ lineHeight: 1.65, margin: '0 0 12px' }} {...props} />;
const H = ({ children }) => <h2 style={{ fontSize: 18, margin: '26px 0 10px' }}>{children}</h2>;
const Sub = ({ children }) => <h3 style={{ fontSize: 15, margin: '18px 0 8px' }}>{children}</h3>;
const Updated = () => <p className="muted" style={{ fontSize: 13 }}>Effective date: {CO.effective}</p>;

function Shell({ children }) {
  const tab = ({ isActive }) => ({
    padding: '7px 12px', borderRadius: 999, textDecoration: 'none', fontSize: 13.5, fontWeight: 600,
    color: isActive ? 'var(--primary-contrast)' : 'var(--text)',
    background: isActive ? 'var(--primary)' : 'var(--surface)',
    border: '1px solid var(--border)',
  });
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 18px 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Logo size={26} />
          <span style={{ fontWeight: 800, fontSize: 17 }}>{CO.product}</span>
          <a href="/" className="btn" style={{ marginLeft: 'auto' }}>← Back to app</a>
        </header>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
          <NavLink to="/legal/privacy" style={tab}>Privacy</NavLink>
          <NavLink to="/legal/terms" style={tab}>Terms &amp; Arbitration</NavLink>
          <NavLink to="/legal/dmca" style={tab}>DMCA / UGC</NavLink>
        </nav>
        <div className="card" style={{ padding: '22px 24px' }}>{children}</div>
        <footer className="muted" style={{ fontSize: 12, marginTop: 20, textAlign: 'center' }}>
          © {new Date().getFullYear()} {CO.entity}. {CO.product} is field-service dispatch software.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy Policy — includes the FTC-aligned AI disclosure and an Apple-style
// "privacy nutrition label" summary table.
// ---------------------------------------------------------------------------
function Privacy() {
  const rows = [
    ['Contact info', 'Name, work email', 'Account creation, sign-in, team invitations', 'Linked to you', 'No'],
    ['Identifiers', 'User ID, org ID, session token', 'Authentication, multi-tenant access control', 'Linked to you', 'No'],
    ['Work content you enter', 'Projects, jobs, punch items, notes, item costs, timesheets', 'Provide the service to your organization', 'Linked to you', 'No'],
    ['Photos / files', 'Job-site photos you upload', 'Attach to the job/item you chose', 'Linked to you', 'No'],
    ['Approximate location', 'Addresses you type; map tiles you view', 'Show jobs on a map (geocoded via OpenStreetMap)', 'Linked to you', 'No'],
    ['Usage & diagnostics', 'Error reports, performance traces (Sentry)', 'Detect and fix crashes; keep the app reliable', 'Linked to you', 'No'],
    ['AI prompts & outputs', 'Text you send to the assistant + generated replies', 'Produce the assistant response you requested', 'Linked to you', 'No'],
  ];
  return (
    <>
      <h1 style={{ fontSize: 26, margin: '0 0 6px' }}>Privacy Policy</h1>
      <Updated />
      <Banner />
      <P>
        This policy explains what {CO.entity} (“we,” “us”) collects when you use {CO.product}
        {' '}(the “Service”), why, and the choices you have. {CO.product} is a business tool: most
        data is entered by your employer’s workspace administrators and belongs to that
        organization (the “Customer”). If you use {CO.product} through your employer, that
        organization controls your account and this policy supplements their own.
      </P>

      <H>Privacy at a glance</H>
      <P className="muted" style={{ fontSize: 13 }}>
        A plain-language summary — the “nutrition label.” The full text below controls.
        We do <strong>not</strong> sell your personal information, we do <strong>not</strong> use
        it for cross-app tracking or advertising, and we do <strong>not</strong> use your content
        to train AI models.
      </P>
      <div style={{ overflowX: 'auto' }}>
        <table className="data" style={{ width: '100%', minWidth: 640 }}>
          <thead>
            <tr>
              <th>Data type</th><th>Examples</th><th>Purpose</th><th>Identity</th><th>Used to track you?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td className="muted">{r[1]}</td>
                <td className="muted">{r[2]}</td>
                <td>{r[3]}</td>
                <td>{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H>Information we collect</H>
      <P>
        <strong>You give us:</strong> your name and work email (via our authentication provider,
        Clerk), the work content you enter, and photos you upload. <strong>Automatically:</strong>
        {' '}standard log data (IP address, timestamps), and — only if enabled — crash and
        performance diagnostics through Sentry. We do not use third-party advertising cookies.
      </P>

      <H>How we use it</H>
      <P>
        To provide and secure the Service, enforce workspace access controls, respond to support
        requests, prevent abuse (including rate limiting), and comply with law. We process the
        data on the lawful basis of performing our contract with the Customer and our legitimate
        interest in operating a secure service.
      </P>

      <H>AI features — how they work and their limits</H>
      <P>
        {CO.product} offers optional AI-assisted features (for example, drafting or summarizing
        job notes). This section is our <strong>artificial-intelligence disclosure</strong>, provided
        so you are not misled about what the AI does — consistent with U.S. Federal Trade
        Commission guidance on truthful AI claims.
      </P>
      <ul style={{ lineHeight: 1.65, margin: '0 0 12px', paddingLeft: 20 }}>
        <li><strong>What it is.</strong> A generative AI assistant powered by a third-party model provider, {AI_SUBPROCESSOR}. When you use it, the text of your prompt and the relevant workspace context you include is sent to that provider to generate a response.</li>
        <li><strong>It can be wrong.</strong> AI output is generated by a statistical model and may be inaccurate, incomplete, or outdated (“hallucinations”). It is <strong>not</strong> professional, legal, medical, financial, or safety advice. Verify anything important before relying on it.</li>
        <li><strong>Human in control.</strong> The assistant only makes suggestions. It does not autonomously take actions, dispatch jobs, move money, or make decisions that have legal or similarly significant effects about any person. A human always reviews and decides.</li>
        <li><strong>Your data is not used to train models.</strong> We instruct our AI provider not to use your prompts or outputs to train their models, and we do not use them to train any model of our own.</li>
        <li><strong>Clearly labeled.</strong> AI-generated content is identified as such in the interface, and use of the assistant is optional.</li>
        <li><strong>Provider terms.</strong> Data sent to the AI provider is handled under that provider’s enterprise terms and security practices; it acts as our subprocessor.</li>
      </ul>

      <H>Sharing &amp; subprocessors</H>
      <P>
        We share personal data only with service providers who help us run {CO.product}, under
        contract and only as needed: Clerk (authentication), Supabase (database &amp; file storage),
        our hosting provider, Sentry (error monitoring), OpenStreetMap/Nominatim (map tiles &amp;
        geocoding for addresses you enter), and {AI_SUBPROCESSOR} (AI features). We disclose data
        if required by law or to protect rights and safety. We do not sell personal information.
      </P>

      <H>Retention</H>
      <P>
        We keep workspace content for as long as the Customer’s account is active and as needed to
        provide the Service, then delete or anonymize it within a commercially reasonable period,
        unless a longer period is required by law. Administrators can export or delete workspace
        data from within the app.
      </P>

      <H>Security</H>
      <P>
        We use encryption in transit, a strict Content-Security-Policy, per-tenant access controls
        enforced in the data layer, rate limiting, and least-privilege server credentials. No system
        is perfectly secure, but we work to protect your data and to notify affected parties of
        breaches as the law requires.
      </P>

      <H>Your choices &amp; rights</H>
      <P>
        Depending on where you live (e.g., California/CPRA, EU/UK GDPR), you may have rights to
        access, correct, delete, or port your data, and to object to certain processing. Because
        your employer typically controls your workspace data, we will route requests to the relevant
        Customer where appropriate. To exercise a right, contact us at {CO.contactEmail}. We do not
        “sell” or “share” personal information for cross-context behavioral advertising as those
        terms are defined under California law.
      </P>

      <H>Children</H>
      <P>{CO.product} is a workplace tool not directed to children and is not intended for anyone under 16.</P>

      <H>Changes &amp; contact</H>
      <P>
        We will post material changes here and update the effective date. Questions or requests:
        {' '}<a href={`mailto:${CO.contactEmail}`}>{CO.contactEmail}</a>, or {CO.entity}, {CO.postalAddress}.
      </P>
    </>
  );
}

// ---------------------------------------------------------------------------
// Terms of Service — with binding arbitration + class-action waiver.
// ---------------------------------------------------------------------------
function Terms() {
  return (
    <>
      <h1 style={{ fontSize: 26, margin: '0 0 6px' }}>Terms of Service</h1>
      <Updated />
      <Banner />
      <P>
        These Terms are a binding agreement between you and {CO.entity} governing your use of
        {' '}{CO.product} (the “Service”). By accessing the Service you agree to these Terms. If you
        use the Service for an organization, you represent that you are authorized to bind it.
      </P>

      <H>1. The Service</H>
      <P>
        {CO.product} provides field-service dispatch, project, timesheet, and item-cost tools. We may
        update, improve, or discontinue features. Access is provided to invited members of a
        workspace, subject to the role-based permissions set by workspace administrators.
      </P>

      <H>2. Accounts &amp; acceptable use</H>
      <P>
        Keep your login credentials secure; you are responsible for activity under your account. You
        agree not to misuse the Service — including no unlawful use, no attempts to breach security or
        access other tenants’ data, no reverse engineering except as permitted by law, no automated
        abuse, and no uploading of malware or infringing content.
      </P>

      <H>3. Your content</H>
      <P>
        You retain ownership of the content you submit (“Customer Content”). You grant us a limited
        license to host, process, and display it solely to provide the Service. You are responsible
        for Customer Content and for having the rights to it. See our{' '}
        <Link to="/legal/dmca">DMCA / User Content Policy</Link>.
      </P>

      <H>4. AI features</H>
      <P>
        AI-assisted features are provided “as is” and may produce inaccurate output. They are
        suggestions only and do not replace professional judgment. Do not rely on AI output for any
        decision with legal, financial, medical, or safety consequences without independent human
        verification. See the AI disclosure in our <Link to="/legal/privacy">Privacy Policy</Link>.
      </P>

      <H>5. Fees</H>
      <P>Fees, if any, are as agreed in an order or subscription. Taxes are your responsibility unless stated otherwise.</P>

      <H>6. Disclaimers</H>
      <P style={{ textTransform: 'none' }}>
        THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO
        THE FULLEST EXTENT PERMITTED BY LAW.
      </P>

      <H>7. Limitation of liability</H>
      <P style={{ textTransform: 'none' }}>
        TO THE FULLEST EXTENT PERMITTED BY LAW, {CO.entity.toUpperCase()} WILL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR
        DATA. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID
        US FOR THE SERVICE IN THE 12 MONTHS BEFORE THE CLAIM OR (B) US $100.
      </P>

      <H>8. Indemnification</H>
      <P>
        You will indemnify and hold {CO.entity} harmless from claims arising out of your Customer
        Content or your breach of these Terms, to the extent permitted by law.
      </P>

      <div className="card" style={{ padding: '16px 18px', margin: '20px 0', background: 'var(--surface-2)' }}>
        <H>9. Binding arbitration &amp; class-action waiver</H>
        <P style={{ textTransform: 'none' }}>
          <strong>PLEASE READ THIS SECTION CAREFULLY — IT AFFECTS YOUR LEGAL RIGHTS,</strong> including
          your right to sue in court and to have a jury trial.
        </P>
        <Sub>9.1 Informal resolution first</Sub>
        <P>
          Before starting an arbitration, you agree to try to resolve the dispute informally by emailing
          {' '}{CO.legalEmail} with a description of the claim. If it is not resolved within 30 days,
          either party may begin arbitration.
        </P>
        <Sub>9.2 Agreement to arbitrate</Sub>
        <P>
          You and {CO.entity} agree that any dispute, claim, or controversy arising out of or relating to
          these Terms or the Service will be resolved by <strong>final and binding individual
          arbitration</strong> administered by {CO.arbForum} under {CO.arbRules}, rather than in court,
          except as provided below. The Federal Arbitration Act governs the interpretation and enforcement
          of this section.
        </P>
        <Sub>9.3 Class-action &amp; jury waiver</Sub>
        <P style={{ textTransform: 'none' }}>
          <strong>YOU AND {CO.entity.toUpperCase()} AGREE TO BRING CLAIMS ONLY IN AN INDIVIDUAL CAPACITY,
          AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY CLASS, COLLECTIVE, OR REPRESENTATIVE PROCEEDING.</strong>
          {' '}The arbitrator may not consolidate more than one person’s claims. You and we waive any right to a jury trial.
        </P>
        <Sub>9.4 Exceptions</Sub>
        <P>
          Either party may (a) bring an individual claim in small-claims court if it qualifies, and (b) seek
          injunctive relief in court for infringement or misuse of intellectual property. Nothing here waives
          any non-waivable statutory right.
        </P>
        <Sub>9.5 Your right to opt out</Sub>
        <P>
          You may opt out of this arbitration agreement within <strong>30 days</strong> of first accepting
          these Terms by emailing {CO.legalEmail} with your name and a statement that you opt out of
          arbitration. Opting out does not affect any other part of these Terms.
        </P>
        <Sub>9.6 Severability</Sub>
        <P>
          If the class-action waiver is found unenforceable as to a claim, that claim will proceed in court;
          the rest of this section still applies.
        </P>
      </div>

      <H>10. Governing law &amp; venue</H>
      <P>
        These Terms are governed by the laws of the State of {CO.governingState}, without regard to conflict
        rules. Disputes not subject to arbitration will be brought in the state or federal courts located in
        {' '}{CO.governingState}, and you consent to their jurisdiction.
      </P>

      <H>11. Termination</H>
      <P>
        You may stop using the Service at any time. We may suspend or terminate access for breach or to
        comply with law. Provisions that by their nature should survive (ownership, disclaimers, liability
        limits, arbitration) survive termination.
      </P>

      <H>12. Changes</H>
      <P>
        We may update these Terms; material changes will be posted here with a new effective date. Continued
        use after changes means you accept them. Contact: {CO.legalEmail}.
      </P>
    </>
  );
}

// ---------------------------------------------------------------------------
// DMCA / User-Generated-Content policy + designated agent.
// ---------------------------------------------------------------------------
function Dmca() {
  return (
    <>
      <h1 style={{ fontSize: 26, margin: '0 0 6px' }}>Copyright (DMCA) &amp; User Content Policy</h1>
      <Updated />
      <Banner />
      <P>
        {CO.product} lets users upload content such as job-site photos, notes, and files (“User
        Content”). {CO.entity} does not pre-screen User Content and is not responsible for it; the
        user who submits it is. We respect intellectual-property rights and respond to valid notices
        under the U.S. Digital Millennium Copyright Act (“DMCA”), 17 U.S.C. § 512.
      </P>

      <div className="card" style={{ padding: '14px 16px', margin: '16px 0', borderColor: 'var(--warning, #b8860b)', background: 'color-mix(in srgb, var(--warning, #b8860b) 12%, transparent)' }}>
        <strong>Action required for safe-harbor eligibility.</strong>
        <P className="muted" style={{ margin: '6px 0 0' }}>
          DMCA § 512(c) safe harbor applies only once you register a Designated Agent with the U.S.
          Copyright Office. Register (and keep renewed) at{' '}
          <a href="https://www.copyright.gov/dmca-directory/" target="_blank" rel="noreferrer">
            copyright.gov/dmca-directory
          </a>{' '}
          (the DMCA Designated Agent Directory), then confirm the agent details below match your
          filing. Until you do, this notice-and-takedown process still operates as a policy but the
          statutory safe harbor is not secured.
        </P>
      </div>

      <H>Reporting alleged infringement</H>
      <P>Send a written notice to our Designated Copyright Agent that includes all of the following:</P>
      <ol style={{ lineHeight: 1.65, margin: '0 0 12px', paddingLeft: 20 }}>
        <li>Your physical or electronic signature.</li>
        <li>Identification of the copyrighted work claimed to be infringed.</li>
        <li>Identification of the material you claim is infringing and enough detail for us to locate it (e.g., a link or the job/item it is attached to).</li>
        <li>Your contact information (name, address, phone, email).</li>
        <li>A statement that you have a good-faith belief the use is not authorized by the owner, its agent, or the law.</li>
        <li>A statement, under penalty of perjury, that the information is accurate and that you are the owner or authorized to act on the owner’s behalf.</li>
      </ol>

      <div className="card" style={{ padding: '14px 16px', margin: '12px 0', background: 'var(--surface-2)' }}>
        <strong>Designated Copyright Agent</strong>
        <div className="muted" style={{ marginTop: 6, lineHeight: 1.7 }}>
          {CO.dmcaAgentName}<br />
          {CO.entity}<br />
          {CO.postalAddress}<br />
          Email: <a href={`mailto:${CO.dmcaEmail}`}>{CO.dmcaEmail}</a><br />
          Phone: {CO.dmcaPhone}
        </div>
      </div>

      <H>Counter-notification</H>
      <P>
        If your content was removed and you believe it was a mistake or misidentification, you may send
        a counter-notice to the same agent including: your signature; identification of the removed
        material and where it appeared; a statement under penalty of perjury that you have a good-faith
        belief the removal was a mistake; your name, address, and phone; and your consent to the
        jurisdiction of the federal court for your district (or, if outside the U.S., any district where
        we may be found), and that you will accept service from the complaining party.
      </P>

      <H>Repeat-infringer policy</H>
      <P>
        In appropriate circumstances and at our discretion, we will disable or terminate the accounts
        of users who are repeat infringers.
      </P>

      <H>False claims</H>
      <P>
        Under 17 U.S.C. § 512(f), anyone who knowingly materially misrepresents that material is
        infringing — or was removed by mistake — may be liable for damages. Do not make false claims.
      </P>

      <H>Contact</H>
      <P>Copyright questions: <a href={`mailto:${CO.dmcaEmail}`}>{CO.dmcaEmail}</a>.</P>
    </>
  );
}

function LegalIndex() {
  return <Navigate to="/legal/privacy" replace />;
}

// Standalone app mounted (see main.jsx) whenever the path starts with /legal,
// so these pages are reachable without signing in. Has its own router; reach it
// with a full-page link (<a href="/legal/…">) from inside the SPA.
export default function LegalApp() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/legal" element={<LegalIndex />} />
          <Route path="/legal/privacy" element={<Privacy />} />
          <Route path="/legal/terms" element={<Terms />} />
          <Route path="/legal/dmca" element={<Dmca />} />
          <Route path="*" element={<Navigate to="/legal/privacy" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
