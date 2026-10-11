import { h } from '../core/dom.js';

// Original cut-paper landscape: decorative, static and colored by theme tokens.
export function homePaper() {
  return h('svg', {class:'home-paper',viewBox:'0 0 1600 800',preserveAspectRatio:'none',aria:{hidden:'true'},attrs:{focusable:'false'}},
    h('path',{class:'home-paper__back',d:'M850 0H1600V660C1440 740 1280 420 1130 455S895 300 850 0Z'}),
    h('path',{class:'home-paper__ochre',d:'M1010 380C1200 405 1160 170 1370 180S1530 315 1600 290V800H620C760 655 880 655 1010 380Z'}),
    h('path',{class:'home-paper__rose',d:'M620 750C855 720 895 510 1050 530S1240 670 1370 490S1520 440 1600 510V800H620Z'}),
    h('path',{class:'home-paper__edge',d:'M0 750C260 675 360 785 660 730S925 650 1060 715S1350 750 1600 660V800H0Z'}),
    h('path',{class:'home-paper__front',d:'M0 758C260 683 360 793 660 738S925 658 1060 723S1350 758 1600 668V800H0Z'}));
}
