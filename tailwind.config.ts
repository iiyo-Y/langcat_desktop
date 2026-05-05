import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置 — LangCat 品牌设计 token
 *
 * 唯一真相源在 src/config/theme.ts(与 langcat_chome 完全一致)。
 * 不要在组件里写死 #4F65F5 之类字面量(规则 5)。
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  theme: {
    extend: {
      colors: {
        langcat: {
          brand: '#4F65F5',
          mouth: '#EE3A5F',
          outline: '#1F2D4D',
          crown: '#F8D930',
          scarf: '#7FCFB6',
          white: '#FFFFFF',
          'pale-blue': '#A8B5F8',
        },
      },
      fontFamily: {
        langcat: [
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Helvetica Neue"',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        'langcat-card': '16px',
        'langcat-button': '999px',
        'langcat-small': '8px',
      },
      borderWidth: {
        langcat: '3px',
        'langcat-thin': '2px',
      },
      boxShadow: {
        langcat: '0 4px 0 0 #1F2D4D',
        'langcat-lg': '0 6px 0 0 #1F2D4D',
      },
      animation: {
        'langcat-pop': 'langcatPop 0.18s ease-out',
      },
      keyframes: {
        langcatPop: {
          '0%': { transform: 'scale(0.92) translateY(-4px)', opacity: '0' },
          '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
        },
      },
    },
  },

  plugins: [],
};

export default config;
