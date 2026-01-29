export function getDom() {
  const byId = (id) => document.getElementById(id);
  return {
    canvas: byId("canvas"),
    selectRect: byId("selectRect"),
    totalPointsSelect: byId("totalPointsSelect"),
    budgetSlider: byId("budgetSlider"),
    budgetValue: byId("budgetValue"),
    sseSlider: byId("sseSlider"),
    sseValue: byId("sseValue"),
    selectToggleBtn: byId("selectToggle"),
    clearSelectionBtn: byId("clearSelection"),
    showOctreeToggleBtn: byId("showOctreeToggle"),
    freezeLodToggleBtn: byId("freezeLodToggle"),
    rebuildBtn: byId("rebuildBtn"),
    // 信息面板元素
    infoTotal: byId("infoTotal"),
    infoVisibleNodes: byId("infoVisibleNodes"),
    infoTotalNodes: byId("infoTotalNodes"),
    infoRendered: byId("infoRendered"),
    infoBudget: byId("infoBudget"),
    infoLoaded: byId("infoLoaded"),
    infoMemory: byId("infoMemory"),
    infoSelected: byId("infoSelected"),
    infoFps: byId("infoFps")
  };
}
