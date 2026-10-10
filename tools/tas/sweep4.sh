#!/bin/bash
# usage: sweep4.sh tag 'cfg1' 'cfg2' ...   (L=labels|all ; results saved per config)
L=${L:-1-2,1-4,2-1,2-5,3-2,3-4,4-3,4-5,5-1,5-5,6-1,6-4,7-3,7-5,8-2,8-7,9-2,9-5,10-3,10-5,11-7,12-4}
tag=$1; shift
i=0
for c in "$@"; do
  i=$((i+1))
  SAVE=tas/sw_${tag}_$i.json node tools/tas/bench4.js "$c" $L 23 > tas/sw_$tag.tmp 2>&1
  tail -1 tas/sw_$tag.tmp >> tas/sw_$tag.log
done
