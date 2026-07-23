const adminStatsService = require('../services/adminStatsService');

exports.getStats = async (req, res) => {
    const stats = await adminStatsService.getDashboardStats(req.admin.hospital_id);
    res.json(stats);
};

exports.getTodayOverview = async (req, res) => {
    const overview = await adminStatsService.getTodayOverview(req.admin.hospital_id);
    res.json(overview);
};

exports.getChartsData = async (req, res) => {
    const charts = await adminStatsService.getChartsData(req.admin.hospital_id);
    res.json(charts);
};
