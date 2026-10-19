# Experitome clean XY style v0.1.0 | SPDX-License-Identifier: MIT
# Usage: p + theme_experitome(); ggsave(..., bg = "transparent", dpi = 600)
# ggplot2 is required; no global theme_set() or analysis changes.
theme_experitome <- function(base_size = 16, base_family = "sans") {
  ggplot2::theme_classic(base_size = base_size, base_family = base_family) +
    ggplot2::theme(
      panel.background = ggplot2::element_blank(),
      panel.grid = ggplot2::element_blank(),
      panel.border = ggplot2::element_blank(),
      plot.background = ggplot2::element_rect(fill = "transparent", colour = NA),
      legend.background = ggplot2::element_blank(),
      legend.key = ggplot2::element_blank(),
      axis.line = ggplot2::element_line(colour = "black", linewidth = 1.1),
      axis.ticks = ggplot2::element_line(colour = "black", linewidth = 1.1),
      axis.line.x.top = ggplot2::element_blank(),
      axis.line.y.right = ggplot2::element_blank(),
      axis.ticks.x.top = ggplot2::element_blank(),
      axis.ticks.y.right = ggplot2::element_blank(),
      axis.text = ggplot2::element_text(size = base_size, colour = "black"),
      axis.title = ggplot2::element_text(size = base_size + 2),
      plot.title = ggplot2::element_text(size = base_size + 4, face = "bold", hjust = 0),
      legend.text = ggplot2::element_text(size = base_size - 2),
      legend.title = ggplot2::element_blank(),
      legend.position = "top"
    )
}
