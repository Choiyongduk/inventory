import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

globalThis.React = React;

function BootError({ error }) {
  const message = error?.stack || error?.message || String(error || '알 수 없는 오류');
  return React.createElement(
    'div',
    { className: 'boot-error' },
    React.createElement('div', { className: 'boot-error-card' },
      React.createElement('strong', null, '앱을 여는 중 오류가 발생했습니다'),
      React.createElement('p', null, '아래 내용을 기준으로 바로 수정할 수 있게 표시했습니다.'),
      React.createElement('pre', null, message),
    ),
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App render error:', error, info);
  }

  render() {
    if (this.state.error) return React.createElement(BootError, { error: this.state.error });
    return this.props.children;
  }
}

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'loading-state boot-loading' },
    React.createElement('div', { className: 'loader' }),
    React.createElement('strong', null, '재고관리 콘솔을 여는 중입니다'),
    React.createElement('span', null, '화면이 비어 보이지 않도록 안전 부팅을 적용했습니다.'),
  ),
);

window.addEventListener('error', (event) => {
  root.render(React.createElement(BootError, { error: event.error || event.message }));
});
window.addEventListener('unhandledrejection', (event) => {
  root.render(React.createElement(BootError, { error: event.reason }));
});

import('./App.jsx')
  .then(({ default: App }) => {
    root.render(
      React.createElement(React.StrictMode, null,
        React.createElement(ErrorBoundary, null, React.createElement(App)),
      ),
    );
  })
  .catch((error) => {
    console.error('App boot error:', error);
    root.render(React.createElement(BootError, { error }));
  });
