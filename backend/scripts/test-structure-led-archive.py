import importlib.util, pathlib, tempfile, unittest, zipfile
spec=importlib.util.spec_from_file_location('collector',pathlib.Path(__file__).with_name('collect-structure-led-holdout.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
class ArchiveTests(unittest.TestCase):
 def test_headerless_first_candle_is_preserved(self):
  row='1638316800000,10,11,9,10,3,1638316859999,30,1,1,10,0\n'
  header='open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore\n'
  with tempfile.TemporaryDirectory() as d:
   results=[]
   for i,text in enumerate([row,header+row]):
    p=pathlib.Path(d)/f'{i}.zip'
    with zipfile.ZipFile(p,'w') as z:z.writestr('data.csv',text)
    results.append(list(collector.records(p)))
   self.assertEqual(results[0],results[1]);self.assertEqual(len(results[0]),1)
 def test_bad_column_count_is_not_silently_accepted(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'bad.zip'
   with zipfile.ZipFile(p,'w') as z:z.writestr('data.csv','1638316800000,10\n')
   with self.assertRaises(ValueError):list(collector.records(p))
if __name__=='__main__':unittest.main()
