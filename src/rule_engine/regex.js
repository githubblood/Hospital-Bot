module.exports = {
    EMERGENCY_REGEX: /^(emergency|sos)$/i,
    MENU_RESET_REGEX: /^(menu|0)$/i,
    // "Name, Age, Gender" e.g. "Ravi Kumar, 34, M"
    PATIENT_REG_REGEX: /^([A-Za-z][A-Za-z\s]{1,49}),\s*(\d{1,3}),\s*(M|F|O)$/i
};
