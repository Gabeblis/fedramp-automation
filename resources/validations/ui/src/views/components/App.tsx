import React from 'react';
import { Banner } from './Banner';
import { Header } from './Header';
import { SSPValidator } from './SSPValidator';

interface AppProps {}

export const App: React.FC<AppProps> = props => {
  return (
    <div>
      <Banner />
      <Header />
      <div className="grid-container">
        <SSPValidator />
      </div>
    </div>
  );
};
