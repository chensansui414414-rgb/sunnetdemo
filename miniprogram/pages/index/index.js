Page({
  data: {
    days: [], loading: true, error: "", period: "evening", cityIndex: 0,
    cityNames: ["南京", "上海", "杭州", "北京", "广州", "成都"],
    cities: [[32.0603,118.7969],[31.2304,121.4737],[30.2741,120.1551],[39.9042,116.4074],[23.1291,113.2644],[30.5728,104.0668]]
  },
  onLoad() { this.loadForecast(); },
  loadForecast() {
    const apiBase = getApp().globalData.apiBase;
    wx.request({
      url: `${apiBase}/api/forecast`, data: { lat: this.data.cities[this.data.cityIndex][0], lon: this.data.cities[this.data.cityIndex][1], period: this.data.period },
      success: ({ data, statusCode }) => {
        if (statusCode !== 200) return this.setData({ loading: false, error: "预测服务暂时不可用" });
        this.setData({ days: data.days, loading: false });
      },
      fail: () => this.setData({ loading: false, error: "请确认后端服务和调试域名设置" })
    });
  },
  chooseCity(event) { this.setData({ cityIndex: Number(event.detail.value), loading: true }); this.loadForecast(); },
  choosePeriod(event) { this.setData({ period: event.currentTarget.dataset.period, loading: true }); this.loadForecast(); },
  toggleDetail(event) {
    const index = event.currentTarget.dataset.index;
    const key = `days[${index}].expanded`;
    this.setData({ [key]: !this.data.days[index].expanded });
  }
});
