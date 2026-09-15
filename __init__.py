"""grill-tab agent half: registers the `grill_tab` auxiliary task.

The REST routes live in dashboard/ and are discovered through dashboard/manifest.json; this
module only makes the plugin's side-model a first-class `auxiliary.grill_tab` slot so it shows up
in `hermes model` → Configure auxiliary models and picks up the standard env/config resolution.
"""

import logging

logger = logging.getLogger(__name__)

AUX_TASK = "grill_tab"


def register(ctx):
    register_task = getattr(ctx, "register_auxiliary_task", None)
    if register_task is None:
        # Hermes < 0.20 has no plugin auxiliary tasks; the engine still reads auxiliary.grill_tab
        # from config.yaml directly, so the plugin keeps working without the picker entry.
        logger.debug("grill-tab: host has no register_auxiliary_task; skipping picker registration")
        return
    register_task(
        AUX_TASK,
        display_name="Grill Tab",
        description="Tab-to-grill questions and brief synthesis",
        defaults={"timeout": 15},
    )
