"""Published reference values used for overlays in the labs.

These are *orientation* values taken from the cited publications (read from their plots or
quoted in their text); they are not a digitised dataset. Each entry carries its source and
an indication of its uncertainty so the UI can label it honestly.
"""

NACA0012 = {
    "source": "Abbott & von Doenhoff, Theory of Wing Sections (1959); Ladson, NASA TM-4074 (1988). "
              "Smooth NACA 0012, Re ~ 3-6e6, values read from the published curves (about +/-0.03 in Cl).",
    "alpha": [0, 2, 4, 6, 8, 10, 12, 14, 16],
    "cl": [0.0, 0.22, 0.44, 0.66, 0.87, 1.07, 1.24, 1.40, 1.52],
    "cd_min": 0.0058,
    "clmax": 1.55,
    "alpha_stall": 16.0,
}

ZERIHAN_ZHANG = {
    "source": "Zerihan & Zhang, J. Aircraft 37(6), 2000 (single-element inverted wing with moving ground): "
              "downforce peaks at h/c ~ 0.08-0.1 and falls below (force-reduction region).",
    "h_peak_band": [0.08, 0.10],
}

WHEEL = {
    "source": "Fackrell & Harvey (1975), isolated wheel in contact with a moving ground.",
    "stationary": {"cd": 0.77, "cl": 0.76},
    "rotating": {"cd": 0.58, "cl": 0.44},
    "jetting_cp_peak": "Cp > 1 just ahead of the contact patch of the rotating wheel",
}

FOLLOWING = {
    "source": "F1/FIA communications on the 2022 regulations (2019-2021): downforce lost by the following car.",
    "2021": {"x_m": [10, 20], "loss": [0.47, 0.35]},
    "2022": {"x_m": [10, 20], "loss": [0.18, 0.04]},
}
