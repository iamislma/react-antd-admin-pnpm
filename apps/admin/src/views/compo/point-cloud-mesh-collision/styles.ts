/**
 * 点云网格化-碰撞模块样式
 */

import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ token }) => ({
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: token.colorBgContainer,
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  controlPanel: {
    position: 'absolute',
    left: 12,
    top: 12,
    zIndex: 10,
    background: token.colorBgElevated,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    padding: '14px 16px',
    width: 320,
    maxHeight: 'calc(100vh - 24px)',
    overflowY: 'auto',
    boxShadow: token.boxShadowSecondary,
    backdropFilter: 'blur(10px)',
  },
  sectionTitle: {
    fontSize: 11,
    color: token.colorTextSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 8,
    marginTop: 12,
  },
  row: {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  statsPanel: {
    position: 'absolute',
    right: 12,
    top: 12,
    zIndex: 10,
    background: token.colorBgElevated,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusLG,
    padding: '12px 16px',
    minWidth: 200,
    boxShadow: token.boxShadowSecondary,
    backdropFilter: 'blur(10px)',
  },
  statsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 4,
    fontSize: 12,
  },
  statsLabel: {
    color: token.colorTextSecondary,
  },
  statsValue: {
    color: token.colorText,
    fontWeight: 500,
  },
  fpsGood: {
    color: token.colorSuccess,
    fontWeight: 600,
  },
  fpsMid: {
    color: token.colorWarning,
    fontWeight: 600,
  },
  fpsBad: {
    color: token.colorError,
    fontWeight: 600,
  },
  hint: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: token.borderRadius,
    fontSize: 12,
    textAlign: 'center' as const,
  },
  sliderContainer: {
    flex: 1,
  },
  inputNumber: {
    width: 70,
  },
}));
