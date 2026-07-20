function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🤖</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>Kanye West Bot</h1>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#23d160', display: 'inline-block' }}></span>
          <span style={{ color: '#23d160', fontWeight: 600 }}>Online</span>
        </div>
        <p style={{ color: '#888', fontSize: 14, maxWidth: 320, margin: '0 auto' }}>
          Instagram ban/unban monitor running 24/7
        </p>
      </div>
    </div>
  );
}

export default App;
