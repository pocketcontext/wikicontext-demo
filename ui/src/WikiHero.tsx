import "./WikiHero.css";

/** Illustrative sample only; the adjacent hero explains the actual workflow. */
export default function WikiHero() {
  return (
    <figure className="wiki-hero-art" aria-label="Illustration: a source document becomes a cited wiki page with help from your coding agent.">
      <div className="wiki-hero-scene" aria-hidden="true">
        <div className="wiki-hero-orbit" />
        <div className="wiki-hero-source">
          <div className="wiki-hero-source-top"><span className="wiki-hero-document">≡</span><span>SOURCE DOCUMENT</span></div>
          <strong>Project notes.md</strong>
          <div className="wiki-hero-lines"><i /><i /><i /></div>
          <span className="wiki-hero-source-foot">Your original, preserved.</span>
        </div>
        <span className="wiki-hero-transfer">↓</span>
        <div className="wiki-hero-agent">
          <div className="wiki-hero-terminal-bar"><span className="wiki-hero-dots"><i /><i /><i /></span><span>YOUR CODING AGENT</span></div>
          <div className="wiki-hero-agent-body">
            <div className="wiki-hero-prompt"><span>›</span> Turn these notes into a wiki.</div>
            <div className="wiki-hero-progress"><span>✓</span> Read the source passages</div>
            <div className="wiki-hero-progress"><span>✓</span> Write and connect the pages</div>
            <div className="wiki-hero-progress"><span>✓</span> Cite the original evidence</div>
            <div className="wiki-hero-published"><span>↗</span> Ready to read.</div>
          </div>
        </div>
        <div className="wiki-hero-page">
          <div className="wiki-hero-page-top"><span className="wiki-hero-book">W</span><span>YOUR WIKI</span><span className="wiki-hero-live">Published</span></div>
          <strong>Project overview</strong>
          <p>Start with a small pilot.<sup>[1]</sup><br />Build on what you learn.<sup>[2]</sup></p>
          <div className="wiki-hero-citation"><span>↗</span><div><b>Project notes.md</b><span>Follow the claim to its source</span></div></div>
        </div>
        <span className="wiki-hero-example">ILLUSTRATIVE EXAMPLE</span>
      </div>
    </figure>
  );
}
