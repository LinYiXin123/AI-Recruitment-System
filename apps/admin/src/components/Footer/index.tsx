import { createStyles } from 'antd-style';
import React from 'react';

const useStyles = createStyles(({ token }) => ({
  footer: {
    padding: '16px 24px',
    textAlign: 'center',
    color: token.colorTextDescription,
    fontSize: token.fontSizeSM,
  },
}));

const Footer: React.FC = () => {
  const { styles } = useStyles();
  return (
    <footer className={styles.footer}>
      AI 招聘系统 · 开发演示，页面数据均为虚构示例
    </footer>
  );
};

export default Footer;
