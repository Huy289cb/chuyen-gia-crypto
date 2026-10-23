import unittest
from screen_hourly_reversal import signal_indices

def bars(values):
 return [[i*3600000,v,v+1,v-1,v,1] for i,v in enumerate(values)]
class ScreenTests(unittest.TestCase):
 def test_uses_only_prior_volatility_and_opposes_move(self):
  x=bars([100,101,100,101,100,120])
  self.assertEqual(signal_indices(x,4)[0][:2],(5,-1))
  x=bars([100,101,100,101,100,80])
  self.assertEqual(signal_indices(x,4)[0][:2],(5,1))
 def test_future_bars_do_not_rewrite_prior_signals(self):
  x=bars([100,101,100,101,100,120]);y=bars([100,101,100,101,100,120,60,160])
  self.assertEqual(signal_indices(x,4),[s for s in signal_indices(y,4) if s[0]<len(x)])
 def test_zero_volatility_and_gaps(self):
  self.assertEqual(signal_indices(bars([100]*10),4),[])
  x=bars([100,101,102]);x[2][0]+=1
  with self.assertRaises(ValueError):signal_indices(x,2)
if __name__=='__main__':unittest.main()
