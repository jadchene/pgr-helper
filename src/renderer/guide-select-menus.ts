import { onMounted, onUnmounted, ref } from 'vue';

/** 攻略表单共用下拉开合规则，页面移动后不保留脱离输入框的菜单。 */
export const useGuideSelectMenus = () => {
  const activeMenu = ref<string | null>(null);

  /** 收起当前菜单，不改变已选择的业务值。 */
  const closeSelectMenus = (): void => {
    activeMenu.value = null;
  };

  /** 同一编辑区域只展开一个菜单，旧菜单的关闭事件不影响新菜单。 */
  const selectMenu = (key: string) => ({
    show: activeMenu.value === key,
    'onUpdate:show': (open: boolean): void => {
      if (open) activeMenu.value = key;
      else if (activeMenu.value === key) closeSelectMenus();
    },
  });

  /** 保留选项列表和搜索框内部滚动；页面滚动则收起浮层。 */
  const handleScroll = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest('.n-base-select-menu, .n-base-selection')) return;
    closeSelectMenus();
  };

  onMounted(() => {
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', closeSelectMenus);
  });
  onUnmounted(() => {
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('resize', closeSelectMenus);
  });

  return { selectMenu, closeSelectMenus };
};
