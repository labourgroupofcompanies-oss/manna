import React from 'react';
import './MannaHeroBanner.css';

interface MannaHeroBannerProps {
  ariaLabel?: string;
}

export const MannaHeroBanner: React.FC<MannaHeroBannerProps> = ({
  ariaLabel = 'Manna — Fast. Easy. Reliable'
}) => {
  return (
    <div className="manna-hero-banner" role="banner" aria-label={ariaLabel}>
      <div className="manna-hero-content">
        <img
          src="/manna-wordmark-white.png"
          alt="Manna"
          className="manna-hero-wordmark"
          draggable={false}
        />

        <div className="manna-hero-slogan" aria-label="Fast. Easy. Reliable">
          <span className="slogan-word">Fast</span>
          <span className="slogan-dot" aria-hidden="true">&bull;</span>
          <span className="slogan-word slogan-highlight">Easy</span>
          <span className="slogan-dot" aria-hidden="true">&bull;</span>
          <span className="slogan-word">Reliable</span>
        </div>

        <svg
          className="manna-hero-swoosh"
          viewBox="0 0 220 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M4 10.5C58 2.5 142 1.2 216 5.8C152 6.8 78 9.2 4 10.5Z"
            fill="url(#mannaGoldSwoosh)"
          />
          <defs>
            <linearGradient id="mannaGoldSwoosh" x1="4" y1="7" x2="216" y2="7" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFB300" stopOpacity="0.25" />
              <stop offset="45%" stopColor="#FFC107" />
              <stop offset="100%" stopColor="#FFE066" stopOpacity="0.85" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
};
