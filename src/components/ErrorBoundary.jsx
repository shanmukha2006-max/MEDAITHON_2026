import { Component } from 'react';
import { AlertTriangle, RefreshCcw, ArrowLeft } from 'lucide-react';

// Catches a crash in one page so the rest of the app keeps working,
// and gives the presenter a one-click way out instead of a blank screen.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Page error caught by ErrorBoundary:', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert" style={{ padding: 24, maxWidth: 640 }}>
        <div className="row" style={{ gap: 10 }}><AlertTriangle size={22} color="var(--concern)" /><h2>This page could not be displayed</h2></div>
        <p className="muted" style={{ marginTop: 8 }}>Something in the saved demo data or this page caused an error. The rest of the app still works. Go back, or reset the demo data to its starting state.</p>
        <p className="tiny muted" style={{ marginTop: 8 }}>Error: {String(this.state.error?.message || this.state.error)}</p>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onHome?.(); }}><ArrowLeft size={16} />Go to start page</button>
          <button className="btn primary" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}><RefreshCcw size={16} />Reset demo data</button>
        </div>
      </div>
    );
  }
}
