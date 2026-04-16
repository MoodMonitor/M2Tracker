// Theme for ShopCountChart. Other charts can define their own themes next to this file.

export type ShopCountChartTheme = {
  layout: {
    paddingTop: number;
    paddingBottom: number;
    cardHeight: number;
    modalHeight: number;
  };

  datasets: {
    bars: {
      thickness: number;
      maxThickness?: number;
      categoryPercentage?: number;
      barPercentage?: number;
      radiusSmall: number; // negative-only bars or bottom of stack
      radiusLarge: number; // top corners when positive growth
      old: { bg: string; hoverBg: string };
      newer: { bg: string; hoverBg: string };
      gone: { bg: string; hoverBg: string };
    };
    line: {
      median: {
        color: string;
        background: string;
        width: number;
        tension: number;
        pointRadius: number;
        pointHoverRadius: number;
        fill: boolean;
        capStyle?: CanvasLineCap;
        joinStyle?: CanvasLineJoin;
      };
    };
  };

  axes: {
    x: {
      tickColor: string;
      tickSize: number;
      gridColor?: string;
    };
    y: {
      tickColor: string;
      gridColor: string;
      borderColor?: string;
      borderWidth?: number;
    };
    y1: {
      tickColor: string;
      gridOnChartArea: boolean;
      borderColor: string;
      borderWidth: number;
    };
  };

  plugins: {
    legend: {
      display: boolean;
      labelColor: string;
    };
    tooltip: {
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      titleColor: string;
    };
    zeroLine: {
      color: string;
      lineWidth: number;
      dash: number[];
    };
  };
};

export const defaultShopCountChartTheme: ShopCountChartTheme = {
  layout: {
    paddingTop: 16,
    paddingBottom: 16,
    cardHeight: 480,
    modalHeight: 520,
  },
  datasets: {
    bars: {
      thickness: 30,
      maxThickness: 28,
      categoryPercentage: 0.8,
      barPercentage: 0.9,
      radiusSmall: 6,
      radiusLarge: 6,
      // Matches current visuals in ShopCountChart.tsx
      old: {
        bg: 'rgba(30, 64, 175, 0.6)',
        hoverBg: 'rgba(30, 64, 175, 1)',
      },
      newer: {
        bg: 'rgba(16, 185, 129, 0.55)',
        hoverBg: 'rgba(16, 185, 129, 0.75)',
      },
      gone: {
        bg: 'rgba(244, 63, 94, 0.55)',
        hoverBg: 'rgba(244, 63, 94, 0.75)',
      },
    },
    line: {
      median: {
        color: 'hsl(45, 70%, 56%)',
        background: 'transparent',
        width: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
      },
    },
  },
  axes: {
    x: {
      tickColor: 'rgba(255,255,255,0.28)',
      tickSize: 12,
      gridColor: 'transparent',
    },
    y: {
      tickColor: 'rgba(255,255,255,0.28)',
      gridColor: 'rgba(255,255,255,0.06)',
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
    },
    y1: {
      tickColor: 'hsl(45, 70%, 56%)',
      gridOnChartArea: false,
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
    },
  },
  plugins: {
    legend: {
      display: true,
      labelColor: 'rgba(255,255,255,0.5)',
    },
    tooltip: {
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      titleColor: '#E5E7EB',
    },
    zeroLine: {
      color: 'rgba(255,255,255,0.28)',
      lineWidth: 1,
      dash: [4, 4],
    },
  },
};
